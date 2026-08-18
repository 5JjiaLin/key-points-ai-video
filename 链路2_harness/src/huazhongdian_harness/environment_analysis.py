from __future__ import annotations

import base64
import json
import re
from dataclasses import replace
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable

from .io_utils import write_json
from .model_json import parse_with_optional_repair
from .models import KnowledgePoint, ManifestCase, VideoContext, VideoFrame, to_jsonable
from .normalizers import parse_knowledge_points
from .providers import LLMProvider


ProgressCallback = Callable[[str, float], None]


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
    analysis_fallbacks: list[str] = []
    total_batches = sum(len(_chunk_context_batches(case, environment, chunk)) for chunk in chunks)
    batch_number = 0
    selection_remote_enabled = True
    for chunk in chunks:
        contexts = _chunk_context_batches(case, environment, chunk)
        for subchunk_index, context in enumerate(contexts, start=1):
            if progress:
                progress("chain2", 0.05 + 0.4 * (batch_number / max(total_batches, 1)))
            error: str | None = None
            try:
                if not selection_remote_enabled:
                    raise RuntimeError("selection remote circuit is open")
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
                if _is_transport_error(error):
                    selection_remote_enabled = False
                selection_mode = "deterministic_fallback"
                raw_output = ""
                parsed_points = _fallback_points_from_context(context)
                analysis_fallbacks.append(f"{chunk['id']}:{subchunk_index}:selection")
            points = [
                _attach_evidence(point, environment["semanticSegments"], case.duration_seconds)
                for point in parsed_points
            ]
            mapped.extend(points)
            raw_chunks.append({
                "chunkId": chunk["id"],
                "subchunkIndex": subchunk_index,
                "selectionMode": selection_mode,
                "raw": raw_output,
                **({"error": error} if error else {}),
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
    if progress:
        progress("chain2", 0.95)

    result = {
        "videoId": case.video_id,
        "status": "ready" if not analysis_fallbacks else "ready_with_fallbacks",
        "fallbacks": analysis_fallbacks,
        "knowledgePoints": [
            {
                "id": point.knowledge_point_id,
                "statement": point.statement,
                "question": _point_question(point),
                "answer": _point_answer(point),
                "startMs": round(point.start_time * 1000),
                "endMs": round(point.end_time * 1000),
                "taskType": point.task_type,
                "evidenceSegmentIds": point.evidence_segment_ids,
            }
            for point in knowledge_points
        ],
    }
    write_json(output / "chunk_candidates.json", raw_chunks)
    write_json(output / "knowledge_points.json", result["knowledgePoints"])
    write_json(output / "chain2_result.json", result)
    return result


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
        lines.append(f"[{item['startMs'] / 1000:.3f}-{item['endMs'] / 1000:.3f}] ({item['id']}) {item['text']}")
    frames = _load_frames(environment, set(chunk.get("keyframeIds") or []), limit=4)
    return VideoContext(case=case, source_text="\n".join(lines), frames=frames)


def _chunk_context_batches(
    case: ManifestCase,
    environment: dict[str, Any],
    chunk: dict[str, Any],
    *,
    max_semantic_segments: int = 4,
) -> list[VideoContext]:
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
    prompt = _build_chunk_selection_prompt(context)
    if context.frames:
        try:
            return provider.complete_with_frames(
                system_prompt="你是严格输出 JSON 的知识点选择器。",
                user_prompt=prompt,
                frames=context.frames,
                temperature=0.4,
            ), "local_keyframes"
        except Exception:
            # A slow/unsupported multimodal request must not discard the shared
            # timestamped ASR/OCR evidence for the whole analysis chunk.
            pass
    return provider.complete(
        system_prompt="你是严格输出 JSON 的知识点选择器。",
        user_prompt=prompt,
        temperature=0.4,
    ), "text_fallback" if context.frames else "timestamped_text"


def _build_chunk_selection_prompt(context: VideoContext) -> str:
    """Compact form of the knowledge-point skill for the H5 chunked main path."""
    return f"""
你是「划重点」知识点选择器。逐段扫描当前分析块，只输出 JSON。

选择规则：
- 只选可出题的完整事实句，不选标题、口号、过渡句或孤立名词。
- 必须有清晰解释价值、用户相关性和问答可行性；不凑数量，不漏掉合格点。
- 相同机制/事实只留一条；同一讲解段的候选应合并或切成连续且不重叠的时间段。
- start_time/end_time 必须是原视频绝对秒数，边界来自输入时间戳，不得改成分析块内相对时间。
- task_type 只能是：原因解释型、误区纠正型、影响结果型、过程变化型、信号识别型、方法决策型、作用说明型、关系结构型、尺度反差型、对比差异型。
- statement 必须忠于原文；画面/OCR 只是证据，不能用常识补造视频没说的结论。

视频：{context.case.title}（{context.case.duration_seconds:.3f}秒）
当前分析块的时间戳证据：
{context.source_text}

输出结构：
{{"knowledge_points":[{{"knowledge_point_id":"kp_001","statement":"完整事实句","start_time":12.3,"end_time":35.6,"selection_scores":{{"fact_complete":1,"description_valid":1,"answer_core":1,"clear_boundary":1,"task_type_clear":1,"explanatory_value":1,"user_relevance":1,"contrast_or_misconception":1,"question_feasible":1,"answer_feasible":1,"question_tension":1,"answer_hook":1,"batch_distinctness":1,"timestamp_precise":1}},"priority":"S","task_type":"原因解释型","tension_triad":{{"common_sense":"...","counterintuitive":"...","explanation":"..."}},"question_direction":"...","answer_core":"...","answer_hook":"...","timestamp_note":"..."}}]}}
""".strip()


def _fallback_points_from_context(context: VideoContext) -> list[KnowledgePoint]:
    points: list[KnowledgePoint] = []
    pattern = re.compile(r"^\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]\s+\(([^)]+)\)\s+(.+)$")
    for line in context.source_text.splitlines():
        match = pattern.match(line.strip())
        if not match or len(match.group(4).strip()) < 8:
            continue
        points.append(
            KnowledgePoint(
                knowledge_point_id=f"fallback-{len(points) + 1}",
                statement=match.group(4).strip(),
                start_time=float(match.group(1)),
                end_time=float(match.group(2)),
                task_type="待模型复核",
                timestamp_note="远程选择失败，保留共享语义段边界",
                question_direction="这段内容的关键结论是什么？",
                answer_core=match.group(4).strip(),
                evidence_segment_ids=[match.group(3)],
            )
        )
    return points


def _point_question(point: KnowledgePoint) -> str:
    return point.question_direction.strip() or "这段内容的关键结论是什么？"


def _point_answer(point: KnowledgePoint) -> str:
    return point.answer_core.strip() or point.statement.strip()


def _is_transport_error(message: str) -> bool:
    normalized = message.lower()
    return any(
        marker in normalized
        for marker in (
            "timeout",
            "timed out",
            "read operation",
            "connecterror",
            "connect error",
            "nodename nor servname",
            "remote circuit is open",
        )
    )


def _attach_evidence(
    point: KnowledgePoint,
    semantic_segments: list[dict[str, Any]],
    duration_seconds: float,
) -> KnowledgePoint:
    start = min(max(point.start_time, 0), duration_seconds)
    end = min(max(point.end_time, start), duration_seconds)
    ids = [
        item["id"]
        for item in semantic_segments
        if item["endMs"] / 1000 >= start and item["startMs"] / 1000 <= end
    ]
    return replace(point, start_time=start, end_time=end, evidence_segment_ids=ids)


def _normalize_text(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", value).casefold()


def _point_score(point: KnowledgePoint) -> int:
    return sum(point.selection_scores.values())
