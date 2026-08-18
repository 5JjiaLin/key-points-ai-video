from __future__ import annotations

import base64
import json
import os
import re
from contextlib import contextmanager
from dataclasses import replace
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable

from .io_utils import write_json
from .environment import build_evidence_environment_snapshot, provider_identity
from .model_json import parse_with_optional_repair
from .models import (
    CardCandidateGroup,
    KnowledgePoint,
    ManifestCase,
    VideoContext,
    VideoFrame,
    to_jsonable,
)
from .normalizers import (
    CandidateGroupAudit,
    parse_candidate_group_audits,
    parse_card_candidate_groups,
    parse_knowledge_points,
)
from .prompts import (
    build_candidate_groups_judge_prompt,
    build_card_generation_prompt,
    build_selection_prompt,
)
from .providers import LLMProvider
from .source_artifact import build_source_knowledge_artifact, write_source_knowledge_artifact
from .tasking import TaskSpec
from .trace import TraceRecorder


ProgressCallback = Callable[[str, float], None]

_VIDEO_GUIDANCE_MARKERS = (
    "看视频",
    "回看",
    "原视频",
    "视频里",
    "视频中",
    "视频会",
    "视频将",
    "对应讲解",
    "对应片段",
    "继续观看",
    "点击查看",
)


class _NullTrace:
    @contextmanager
    def tool(self, _name: str, **_kwargs: Any):
        yield


def analyze_environment(
    *,
    environment_path: str | Path,
    out_dir: str | Path,
    provider: LLMProvider,
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    environment_file = Path(environment_path).expanduser().resolve()
    environment = json.loads(environment_file.read_text(encoding="utf-8"))
    if environment.get("schemaVersion") != "video-environment.v1":
        raise ValueError("chain2 requires video-environment.v1")
    video = environment["video"]
    case = ManifestCase(
        case_id=str(video["id"]),
        video_id=str(video["id"]),
        video_path=Path(video["sourcePath"]),
        title=str(video["title"]),
        duration_seconds=float(video["durationMs"]) / 1000,
        language=str(video.get("language") or "zh"),
    )
    output = Path(out_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    trace_path = output / "trace.jsonl"
    trace_path.unlink(missing_ok=True)
    trace = TraceRecorder(trace_path)
    provider_name, model_name = provider_identity(provider)
    task = TaskSpec.from_evidence_environment(
        case,
        environment_path=str(environment_file),
        environment=environment,
    )
    snapshot = build_evidence_environment_snapshot(
        environment=environment,
        provider_name=provider_name,
        model_name=model_name,
    )
    write_json(output / "task_spec.json", task.to_dict())
    write_json(output / "environment_snapshot.json", snapshot)
    trace.append({
        "tool": "task_and_environment",
        "status": "success",
        "input_summary": {
            "task_type": task.task_type,
            "snapshot_id": snapshot["snapshot_id"],
        },
    })
    for obsolete in (
        "card_candidate_batches.json",
        "card_candidates.json",
        "cards.json",
        "candidate_audit.json",
    ):
        (output / obsolete).unlink(missing_ok=True)
    chunks = environment["analysisChunks"]
    mapped: list[KnowledgePoint] = []
    raw_chunks: list[dict[str, Any]] = []
    total_batches = sum(len(_chunk_context_batches(case, environment, chunk)) for chunk in chunks)
    batch_number = 0
    for chunk in chunks:
        contexts = _chunk_context_batches(case, environment, chunk)
        for subchunk_index, context in enumerate(contexts, start=1):
            if progress:
                progress("chain2", 0.05 + 0.4 * (batch_number / max(total_batches, 1)))
            error: str | None = None
            try:
                with trace.tool(
                    "knowledge_point_selection",
                    input_summary={
                        "chunk_id": chunk["id"],
                        "subchunk_index": subchunk_index,
                        "snapshot_id": snapshot["snapshot_id"],
                    },
                ):
                    raw, selection_mode = _complete_selection(provider, context)
                    parsed = parse_with_optional_repair(
                        raw=raw,
                        parser=parse_knowledge_points,
                        provider=provider,
                        expected_schema='{"knowledge_points":[...]}',
                        stage=f"chunk:{chunk['id']}:{subchunk_index}",
                    )
                raw_output = parsed.raw
                parsed_points = parsed.value
            except Exception as exc:
                error = str(exc)
                raise RuntimeError(
                    "chain2 knowledge point selection failed at "
                    f"{chunk['id']}:{subchunk_index}: {error}"
                ) from exc
            points, rejected_count = _constrain_points_to_evidence(
                parsed_points,
                environment,
                case.duration_seconds,
            )
            mapped.extend(points)
            raw_chunks.append({
                "chunkId": chunk["id"],
                "subchunkIndex": subchunk_index,
                "selectionMode": selection_mode,
                "raw": raw_output,
                **({"error": error} if error else {}),
                "rejectedCount": rejected_count,
                "points": to_jsonable(points),
            })
            batch_number += 1

    knowledge_points = [
        replace(point, knowledge_point_id=f"kp_{index:03d}")
        for index, point in enumerate(
            merge_knowledge_points(mapped, duration_seconds=case.duration_seconds), start=1
        )
    ]
    if not knowledge_points:
        raise ValueError("chain2 produced no knowledge points")

    qa_context = _qa_evidence_context(case, environment, knowledge_points)
    candidate_groups, generation_batches = _generate_question_answers(
        context=qa_context,
        knowledge_points=knowledge_points,
        provider=provider,
        progress=progress,
        batch_size=_qa_batch_size(),
        trace=trace,
    )
    selected_answers, audit_batches = _audit_question_answers(
        context=qa_context,
        knowledge_points=knowledge_points,
        candidate_groups=candidate_groups,
        provider=provider,
        progress=progress,
        batch_size=_qa_batch_size(),
        trace=trace,
    )
    approved_points = [
        point for point in knowledge_points
        if point.knowledge_point_id in selected_answers
    ]
    if not approved_points:
        raise ValueError("chain2 quality audit approved no knowledge points")
    if progress:
        progress("chain2", 0.95)

    result = {
        "videoId": case.video_id,
        "status": "ready",
        "fallbacks": [],
        "knowledgePoints": [
            {
                "id": point.knowledge_point_id,
                "statement": point.statement,
                "question": selected_answers[point.knowledge_point_id][0],
                "answer": selected_answers[point.knowledge_point_id][1],
                "startMs": round(point.start_time * 1000),
                "endMs": round(point.end_time * 1000),
                "taskType": point.task_type,
                "evidenceSegmentIds": point.evidence_segment_ids,
            }
            for point in approved_points
        ],
    }
    write_json(output / "chunk_candidates.json", raw_chunks)
    write_json(output / "question_answer_candidate_batches.json", generation_batches)
    write_json(output / "quality_audit.json", audit_batches)
    write_json(output / "knowledge_points.json", result["knowledgePoints"])
    write_json(output / "chain2_result.json", result)
    source_artifact_path = output / "source-knowledge-artifact.v1.json"
    write_source_knowledge_artifact(
        source_artifact_path,
        build_source_knowledge_artifact(
            environment_path=environment_file,
            video_id=case.video_id,
            knowledge_points=result["knowledgePoints"],
        ),
    )
    trace.append({
        "tool": "artifact.source_knowledge",
        "status": "success",
        "output_path": str(source_artifact_path),
        "input_summary": {"knowledge_point_count": len(result["knowledgePoints"])},
    })
    trace.append({
        "tool": "chain2_result",
        "status": "success",
        "output_path": str(output / "chain2_result.json"),
        "input_summary": {
            "knowledge_point_count": len(knowledge_points),
            "approved_knowledge_point_count": len(approved_points),
            "fallback_count": 0,
        },
    })
    return result


def _generate_question_answers(
    *,
    context: VideoContext,
    knowledge_points: list[KnowledgePoint],
    provider: LLMProvider,
    progress: ProgressCallback | None,
    batch_size: int = 4,
    trace: TraceRecorder | None = None,
) -> tuple[list[CardCandidateGroup], list[dict[str, Any]]]:
    groups: list[CardCandidateGroup] = []
    records: list[dict[str, Any]] = []
    batches = [
        knowledge_points[offset : offset + batch_size]
        for offset in range(0, len(knowledge_points), batch_size)
    ]
    for batch_index, points in enumerate(batches, start=1):
        if progress:
            progress("chain2", 0.48 + 0.16 * ((batch_index - 1) / max(len(batches), 1)))
        error: str | None = None
        try:
            with (trace or _NullTrace()).tool(
                "question_answer_generation",
                input_summary={
                    "batch_index": batch_index,
                    "knowledge_point_ids": [point.knowledge_point_id for point in points],
                },
            ):
                prompt = build_card_generation_prompt(context, points)
                raw = provider.complete(
                    system_prompt=(
                        "你是严格输出 JSON 的知识点问题答案候选生成器。"
                        "只能依据 Harness 提供的 ASR/OCR 证据改写问题和答案；"
                        "答案必须独立、完整、清楚，禁止任何看视频或回看引导。"
                    ),
                    user_prompt=prompt,
                    temperature=0.0,
                )
                parsed = parse_with_optional_repair(
                    raw=raw,
                    parser=lambda value: parse_card_candidate_groups(
                        value,
                        default_video_id=context.case.video_id,
                    ),
                    provider=provider,
                    expected_schema=(
                        '{"candidate_groups":[{"knowledge_point_id":"kp_001",'
                        '"candidates":[...]}]}'
                    ),
                    stage=f"question_generation:{batch_index}",
                )
            batch_groups = parsed.value
            expected_ids = [point.knowledge_point_id for point in points]
            actual_ids = [group.knowledge_point_id for group in batch_groups]
            if actual_ids != expected_ids:
                raise ValueError(
                    "question candidate groups must match knowledge points in source order; "
                    f"expected={expected_ids}, actual={actual_ids}"
                )
            mode = "model"
        except Exception as exc:
            error = str(exc)
            raise RuntimeError(
                f"chain2 question generation failed at batch {batch_index}: {error}"
            ) from exc
        groups.extend(batch_groups)
        records.append(
            {
                "batchIndex": batch_index,
                "mode": mode,
                **({"error": error} if error else {}),
                "groups": [_question_answer_group_record(group) for group in batch_groups],
            }
        )
    return groups, records


def _audit_question_answers(
    *,
    context: VideoContext,
    knowledge_points: list[KnowledgePoint],
    candidate_groups: list[CardCandidateGroup],
    provider: LLMProvider,
    progress: ProgressCallback | None,
    batch_size: int = 4,
    trace: TraceRecorder | None = None,
) -> tuple[dict[str, tuple[str, str]], list[dict[str, Any]]]:
    points_by_id = {point.knowledge_point_id: point for point in knowledge_points}
    selected: dict[str, tuple[str, str]] = {}
    records: list[dict[str, Any]] = []
    batches = [
        candidate_groups[offset : offset + batch_size]
        for offset in range(0, len(candidate_groups), batch_size)
    ]
    for batch_index, groups in enumerate(batches, start=1):
        if progress:
            progress("chain2", 0.68 + 0.24 * ((batch_index - 1) / max(len(batches), 1)))
        points = [points_by_id[group.knowledge_point_id] for group in groups]
        error: str | None = None
        try:
            with (trace or _NullTrace()).tool(
                "question_answer_quality_audit",
                input_summary={
                    "batch_index": batch_index,
                    "knowledge_point_ids": [point.knowledge_point_id for point in points],
                },
            ):
                prompt = build_candidate_groups_judge_prompt(context, points, groups)
                raw = provider.complete(
                    system_prompt=(
                        "你是严格输出 JSON 的问题答案质量审核模型。"
                        "必须依据 Harness 提供的 ASR/OCR 证据审核；"
                        "含看视频、回看或继续观看引导的答案不得通过。"
                    ),
                    user_prompt=prompt,
                    temperature=0.0,
                )
                parsed = parse_with_optional_repair(
                    raw=raw,
                    parser=parse_candidate_group_audits,
                    provider=provider,
                    expected_schema='{"group_audits":[{"knowledge_point_id":"kp_001",...}]}',
                    stage=f"quality_audit:{batch_index}",
                )
            audits = parsed.value
            expected_ids = [group.knowledge_point_id for group in groups]
            actual_ids = [audit.knowledge_point_id for audit in audits]
            if actual_ids != expected_ids:
                raise ValueError(
                    "quality audits must match candidate groups in source order; "
                    f"expected={expected_ids}, actual={actual_ids}"
                )
            for group, audit in zip(groups, audits, strict=True):
                candidate_ids = {candidate.card_id for candidate in group.candidates}
                if set(audit.ranking) != candidate_ids:
                    raise ValueError(
                        f"quality audit candidate ids do not match {group.knowledge_point_id}"
                    )
            mode = "model"
        except Exception as exc:
            error = str(exc)
            raise RuntimeError(
                f"chain2 quality audit failed at batch {batch_index}: {error}"
            ) from exc

        if audits:
            for group, audit in zip(groups, audits, strict=True):
                point = points_by_id[group.knowledge_point_id]
                candidates_by_id = {
                    candidate.card_id: candidate for candidate in group.candidates
                }
                chosen = next(
                    (
                        candidates_by_id[candidate_id]
                        for candidate_id in audit.ranking
                        if audit.candidate_audits[candidate_id].should_keep is not False
                        and audit.candidate_audits[candidate_id].audit_grade not in {"B", "C", "D"}
                        and _is_standalone_answer(
                            candidates_by_id[candidate_id].highlight_answer
                        )
                        and _is_grounded_answer(
                            candidates_by_id[candidate_id].highlight_answer,
                            point,
                            context.source_text,
                        )
                    ),
                    None,
                )
                if chosen is None:
                    continue
                else:
                    selected[group.knowledge_point_id] = (
                        chosen.hook_question.strip(),
                        chosen.highlight_answer.strip(),
                    )

        records.append(
            {
                "batchIndex": batch_index,
                "mode": mode,
                **({"error": error} if error else {}),
                "audits": [_quality_audit_record(audit) for audit in audits],
            }
        )
    return selected, records


def _question_answer_group_record(group: CardCandidateGroup) -> dict[str, Any]:
    return {
        "knowledgePointId": group.knowledge_point_id,
        "candidates": [
            {
                "candidateId": candidate.card_id,
                "question": candidate.hook_question,
                "answer": candidate.highlight_answer,
                "startMs": round(candidate.source_start_time * 1000),
                "endMs": round(candidate.source_end_time * 1000),
            }
            for candidate in group.candidates
        ],
    }


def _quality_audit_record(audit: CandidateGroupAudit) -> dict[str, Any]:
    return {
        "knowledgePointId": audit.knowledge_point_id,
        "candidateRanking": audit.ranking,
        "selectedCandidateId": audit.selected_candidate_id,
        "candidateAudits": {
            candidate_id: to_jsonable(candidate_audit)
            for candidate_id, candidate_audit in audit.candidate_audits.items()
        },
    }


def merge_knowledge_points(
    points: list[KnowledgePoint], *, duration_seconds: float
) -> list[KnowledgePoint]:
    normalized: list[KnowledgePoint] = []
    for point in sorted(points, key=lambda item: (item.start_time, item.end_time)):
        start = min(max(point.start_time, 0), duration_seconds)
        end = min(max(point.end_time, start), duration_seconds)
        if end - start < 1:
            continue
        current = replace(point, start_time=start, end_time=end)
        if not normalized:
            normalized.append(current)
            continue
        previous = normalized[-1]
        overlap = max(0.0, min(previous.end_time, current.end_time) - max(previous.start_time, current.start_time))
        shorter = max(min(previous.end_time - previous.start_time, current.end_time - current.start_time), 0.001)
        similarity = SequenceMatcher(None, _normalize_text(previous.statement), _normalize_text(current.statement)).ratio()
        if overlap / shorter >= 0.5 or (similarity >= 0.82 and current.start_time - previous.end_time <= 30):
            if _point_score(current) > _point_score(previous):
                normalized[-1] = replace(
                    current,
                    evidence_segment_ids=sorted(set(previous.evidence_segment_ids + current.evidence_segment_ids)),
                )
            else:
                normalized[-1] = replace(
                    previous,
                    evidence_segment_ids=sorted(set(previous.evidence_segment_ids + current.evidence_segment_ids)),
                )
            continue
        if current.start_time < previous.end_time:
            boundary = (current.start_time + previous.end_time) / 2
            normalized[-1] = replace(previous, end_time=max(previous.start_time + 1, boundary))
            current = replace(current, start_time=min(current.end_time - 1, boundary))
        normalized.append(current)
    return normalized


def _chunk_context(case: ManifestCase, environment: dict[str, Any], chunk: dict[str, Any]) -> VideoContext:
    segment_ids = set(chunk.get("semanticSegmentIds") or [])
    segments = [item for item in environment["semanticSegments"] if item["id"] in segment_ids]
    lines = [
        f"【分析块绝对时间 {chunk['startMs'] / 1000:.3f}s - {chunk['endMs'] / 1000:.3f}s】",
        "下面的时间均为原视频绝对时间，输出 start_time/end_time 也必须使用绝对秒数。",
    ]
    for item in segments:
        lines.append(
            f"[ASR {item['startMs'] / 1000:.3f}-{item['endMs'] / 1000:.3f}] "
            f"({item['id']}) {item['text']}"
        )
    for item in environment.get("ocrSegments") or []:
        if item["endMs"] >= chunk["startMs"] and item["startMs"] <= chunk["endMs"]:
            lines.append(
                f"[OCR {item['startMs'] / 1000:.3f}-{item['endMs'] / 1000:.3f}] "
                f"({item['id']}) {item['text']}"
            )
    frames = _load_frames(environment, set(chunk.get("keyframeIds") or []), limit=4)
    return VideoContext(case=case, source_text="\n".join(lines), frames=frames)


def _chunk_context_batches(
    case: ManifestCase,
    environment: dict[str, Any],
    chunk: dict[str, Any],
    *,
    max_semantic_segments: int | None = None,
) -> list[VideoContext]:
    if max_semantic_segments is None:
        max_semantic_segments = _max_semantic_segments_per_request()
    chunk_ids = set(chunk.get("semanticSegmentIds") or [])
    segments = [item for item in environment["semanticSegments"] if item["id"] in chunk_ids]
    if not segments:
        return [_chunk_context(case, environment, chunk)]
    contexts: list[VideoContext] = []
    for offset in range(0, len(segments), max_semantic_segments):
        batch = segments[offset : offset + max_semantic_segments]
        start_ms = batch[0]["startMs"]
        end_ms = batch[-1]["endMs"]
        frame_ids = [
            item["id"]
            for item in environment["keyframes"]
            if item["id"] in set(chunk.get("keyframeIds") or [])
            and start_ms - 2000 <= item["timestampMs"] <= end_ms + 2000
        ]
        contexts.append(
            _chunk_context(
                case,
                environment,
                {
                    **chunk,
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "semanticSegmentIds": [item["id"] for item in batch],
                    "keyframeIds": frame_ids,
                },
            )
        )
    return contexts


def _max_semantic_segments_per_request() -> int:
    raw = os.getenv("CHAIN2_MAX_SEMANTIC_SEGMENTS_PER_REQUEST", "16")
    try:
        return max(1, int(raw))
    except ValueError:
        return 16


def _qa_batch_size() -> int:
    raw = os.getenv("CHAIN2_QA_BATCH_SIZE", "16")
    try:
        return max(1, int(raw))
    except ValueError:
        return 16


def _load_frames(environment: dict[str, Any], frame_ids: set[str], *, limit: int) -> list[VideoFrame]:
    frames: list[VideoFrame] = []
    for item in environment["keyframes"]:
        if item["id"] not in frame_ids or len(frames) >= limit:
            continue
        path = Path(item["path"])
        if not path.is_file():
            continue
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        frames.append(
            VideoFrame(
                timestamp_seconds=item["timestampMs"] / 1000,
                image_data_url=f"data:image/jpeg;base64,{encoded}",
            )
        )
    return frames


def _complete_selection(provider: LLMProvider, context: VideoContext) -> tuple[str, str]:
    supports_frames = bool(getattr(provider, "supports_inline_frames", True))
    prompt_context = context if supports_frames else replace(context, frames=[])
    prompt = _build_chunk_selection_prompt(prompt_context)
    if context.frames and supports_frames:
        try:
            return provider.complete_with_frames(
                system_prompt="你是严格输出 JSON 的知识点选择器。",
                user_prompt=prompt,
                frames=context.frames,
                temperature=0.0,
            ), "local_keyframes"
        except Exception:
            # A slow/unsupported multimodal request must not discard the shared
            # timestamped ASR/OCR evidence for the whole analysis chunk.
            pass
    return provider.complete(
        system_prompt="你是严格输出 JSON 的知识点选择器。",
        user_prompt=prompt,
        temperature=0.0,
    ), "text_fallback" if context.frames and supports_frames else "timestamped_text"


def _build_chunk_selection_prompt(context: VideoContext) -> str:
    return build_selection_prompt(context)


def _is_standalone_answer(answer: str) -> bool:
    normalized = answer.strip()
    return bool(normalized) and not any(
        marker in normalized for marker in _VIDEO_GUIDANCE_MARKERS
    ) and "?" not in normalized and "？" not in normalized


def _attach_evidence(
    point: KnowledgePoint,
    semantic_segments: list[dict[str, Any]],
    duration_seconds: float,
    ocr_segments: list[dict[str, Any]] | None = None,
) -> KnowledgePoint:
    start = min(max(point.start_time, 0), duration_seconds)
    end = min(max(point.end_time, start), duration_seconds)
    ids = [
        item["id"]
        for item in semantic_segments
        if item["endMs"] / 1000 >= start and item["startMs"] / 1000 <= end
    ]
    ids.extend(
        item["id"]
        for item in (ocr_segments or [])
        if item["endMs"] / 1000 >= start and item["startMs"] / 1000 <= end
    )
    return replace(point, start_time=start, end_time=end, evidence_segment_ids=ids)


def _constrain_points_to_evidence(
    points: list[KnowledgePoint],
    environment: dict[str, Any],
    duration_seconds: float,
) -> tuple[list[KnowledgePoint], int]:
    kept: list[KnowledgePoint] = []
    rejected = 0
    for point in points:
        attached = _attach_evidence(
            point,
            environment.get("semanticSegments") or [],
            duration_seconds,
            environment.get("ocrSegments") or [],
        )
        evidence_text = _evidence_text_for_range(
            environment,
            attached.start_time,
            attached.end_time,
        )
        if (
            attached.evidence_segment_ids
            and _is_grounded_text(attached.statement, evidence_text)
            and _is_grounded_text(attached.answer_core or attached.statement, evidence_text)
        ):
            kept.append(attached)
        else:
            rejected += 1
    return kept, rejected


def _qa_evidence_context(
    case: ManifestCase,
    environment: dict[str, Any],
    points: list[KnowledgePoint],
) -> VideoContext:
    evidence_ids = {
        evidence_id
        for point in points
        for evidence_id in point.evidence_segment_ids
    }
    lines: list[str] = []
    for label, key in (("ASR", "semanticSegments"), ("OCR", "ocrSegments")):
        for item in environment.get(key) or []:
            if item["id"] not in evidence_ids:
                continue
            lines.append(
                f"[{label} {item['startMs'] / 1000:.3f}-{item['endMs'] / 1000:.3f}] "
                f"({item['id']}) {item['text']}"
            )
    return VideoContext(case=case, source_text="\n".join(lines))


def _evidence_text_for_range(
    environment: dict[str, Any],
    start_seconds: float,
    end_seconds: float,
) -> str:
    values: list[str] = []
    for key in ("semanticSegments", "ocrSegments"):
        for item in environment.get(key) or []:
            if (
                item["endMs"] / 1000 >= start_seconds
                and item["startMs"] / 1000 <= end_seconds
            ):
                values.append(str(item["text"]))
    return "\n".join(values)


def _is_grounded_answer(answer: str, point: KnowledgePoint, evidence_text: str) -> bool:
    source = "\n".join((evidence_text, point.statement, point.answer_core))
    return _is_grounded_text(answer, source)


def _is_grounded_text(value: str, evidence_text: str) -> bool:
    normalized_value = _normalize_text(value)
    normalized_evidence = _normalize_text(evidence_text)
    if not normalized_value or not normalized_evidence:
        return False
    if normalized_value in normalized_evidence:
        return True
    clauses = [
        _normalize_text(item)
        for item in re.split(r"[。！？!?；;，,]", value)
        if len(_normalize_text(item)) >= 4
    ]
    if not clauses:
        clauses = [normalized_value]
    evidence_lines = [
        _normalize_text(item)
        for item in evidence_text.splitlines()
        if _normalize_text(item)
    ] or [normalized_evidence]
    return all(
        max(
            max(
                SequenceMatcher(None, clause, line).ratio(),
                _ngram_recall(clause, line),
            )
            for line in evidence_lines
        ) >= 0.42
        for clause in clauses
    )


def _ngram_recall(value: str, evidence: str, *, size: int = 2) -> float:
    if len(value) < size:
        return 1.0 if value in evidence else 0.0
    grams = {value[index : index + size] for index in range(len(value) - size + 1)}
    if not grams:
        return 0.0
    return sum(gram in evidence for gram in grams) / len(grams)


def _normalize_text(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", value).casefold()


def _point_score(point: KnowledgePoint) -> int:
    return sum(point.selection_scores.values())
