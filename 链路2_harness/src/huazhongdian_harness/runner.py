from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .environment import build_environment_snapshot, provider_identity
from .ingestion import SidecarVideoIngestionProvider, VideoIngestionProvider
from .io_utils import write_json, write_text
from .manifest import read_manifest
from .model_json import parse_with_optional_repair
from .models import HarnessError, ManifestCase, VideoContext, to_jsonable
from .normalizers import parse_card_candidate_groups, parse_knowledge_points
from .prompts import build_card_generation_prompt, build_selection_prompt
from .providers import LLMProvider
from .tasking import TaskSpec
from .trace import TraceRecorder


def run_harness(
    *,
    manifest_path: str | Path,
    runs: int,
    out_dir: str | Path,
    provider: LLMProvider,
    ingestion_provider: VideoIngestionProvider | None = None,
) -> None:
    if runs < 1:
        raise HarnessError("--runs must be >= 1")

    out_path = Path(out_dir).expanduser().resolve()
    out_path.mkdir(parents=True, exist_ok=True)
    trace = TraceRecorder(out_path / "trace.jsonl")
    with trace.tool("manifest.read", input_summary={"manifest_path": str(manifest_path)}, output_path=out_path / "run_metadata.json"):
        cases = read_manifest(manifest_path, validate_files=True)
    ingestion = ingestion_provider or SidecarVideoIngestionProvider()
    provider_name, model_name = provider_identity(provider)

    write_json(
        out_path / "run_metadata.json",
        {
            "manifest_path": str(Path(manifest_path).expanduser().resolve()),
            "runs": runs,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "case_count": len(cases),
            "provider_name": provider_name,
            "model_name": model_name,
        },
    )
    write_json(
        out_path / "task_specs.json",
        [TaskSpec.from_case(case, runs=runs).to_dict() for case in cases],
    )

    for case in cases:
        _run_case(
            case=case,
            runs=runs,
            out_path=out_path,
            provider=provider,
            ingestion=ingestion,
            trace=trace,
            provider_name=provider_name,
            model_name=model_name,
        )


def _run_case(
    *,
    case: ManifestCase,
    runs: int,
    out_path: Path,
    provider: LLMProvider,
    ingestion: VideoIngestionProvider,
    trace: TraceRecorder,
    provider_name: str,
    model_name: str,
) -> None:
    case_dir = out_path / "cases" / case.case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    write_json(case_dir / "case.json", to_jsonable(case))
    write_json(case_dir / "task_spec.json", TaskSpec.from_case(case, runs=runs).to_dict())

    try:
        with trace.tool(
            "ingestion.load",
            input_summary={"case_id": case.case_id, "video_path": str(case.video_path)},
            output_path=case_dir / "source.json",
        ):
            context = ingestion.load(case)
        write_json(
            case_dir / "source.json",
            {
                "mode": (
                    "file_api"
                    if context.has_file_input
                    else "frame_sequence"
                    if context.has_frame_input
                    else "video"
                    if context.has_video_input
                    else "sidecar_text"
                ),
                "frame_count": len(context.frames) if context.has_frame_input else None,
                "video_fps": context.video_fps if context.has_video_input else None,
                "source_text_path": str(case.sidecar_text_path) if case.sidecar_text_path else None,
            },
        )
        if context.source_text:
            write_text(case_dir / "source_text.txt", context.source_text)
        snapshot = build_environment_snapshot(
            case=case,
            provider_name=provider_name,
            model_name=model_name,
            context=context,
            ingestion_provider=ingestion if isinstance(ingestion, SidecarVideoIngestionProvider) else None,
        )
        write_json(case_dir / "environment_snapshot.json", snapshot)
    except Exception as exc:
        write_json(case_dir / "errors.json", {"stage": "ingestion", "message": str(exc)})
        return

    for run_index in range(1, runs + 1):
        run_dir = case_dir / f"run_{run_index:03d}"
        run_dir.mkdir(parents=True, exist_ok=True)
        raw: dict[str, Any] = {}
        try:
            selection_prompt = build_selection_prompt(context)
            with trace.tool(
                "model.knowledge_points",
                input_summary={"case_id": case.case_id, "run": run_index, "temperature": 0.4},
                output_path=run_dir / "knowledge_points.json",
            ):
                raw_selection = _complete(
                    provider=provider,
                    context=context,
                    system_prompt="你是严格输出 JSON 的知识点选择器。",
                    user_prompt=selection_prompt,
                    temperature=0.4,
                )
                parsed_selection = parse_with_optional_repair(
                    raw=raw_selection,
                    parser=parse_knowledge_points,
                    provider=provider,
                    expected_schema='{"knowledge_points":[...]}',
                    stage="knowledge_points",
                )
            knowledge_points = parsed_selection.value
            raw["selection"] = parsed_selection.raw
            if parsed_selection.repair_used:
                raw["selection_repair"] = {
                    "initial_content": parsed_selection.initial_raw,
                    "initial_error": parsed_selection.initial_error,
                }
            write_json(run_dir / "knowledge_points.json", knowledge_points)

            generation_prompt = build_card_generation_prompt(context, knowledge_points)
            with trace.tool(
                "model.cards",
                input_summary={"case_id": case.case_id, "run": run_index, "temperature": 0.7},
                output_path=run_dir / "card_candidates.json",
            ):
                raw_cards = _complete(
                    provider=provider,
                    context=context,
                    system_prompt="你是严格输出 JSON 的划重点追回卡生成器。",
                    user_prompt=generation_prompt,
                    temperature=0.7,
                )
                parsed_groups = parse_with_optional_repair(
                    raw=raw_cards,
                    parser=lambda value: parse_card_candidate_groups(
                        value,
                        default_video_id=case.video_id,
                    ),
                    provider=provider,
                    expected_schema='{"candidate_groups":[{"knowledge_point_id":"kp_001","candidates":[...]}]}',
                    stage="cards",
                )
            candidate_groups = parsed_groups.value
            expected_ids = [point.knowledge_point_id for point in knowledge_points]
            actual_ids = [group.knowledge_point_id for group in candidate_groups]
            if actual_ids != expected_ids:
                raise HarnessError(
                    "candidate_groups must contain exactly one group per knowledge point "
                    f"in source order; expected={expected_ids}, actual={actual_ids}"
                )
            raw["cards"] = parsed_groups.raw
            if parsed_groups.repair_used:
                raw["cards_repair"] = {
                    "initial_content": parsed_groups.initial_raw,
                    "initial_error": parsed_groups.initial_error,
                }
            write_json(run_dir / "card_candidates.json", candidate_groups)
            write_json(run_dir / "raw.json", raw)
        except Exception as exc:
            write_json(run_dir / "raw.json", raw)
            write_json(run_dir / "errors.json", {"stage": "model", "message": str(exc)})


def _complete(
    *,
    provider: LLMProvider,
    context: VideoContext,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
) -> str:
    if context.has_file_input:
        return provider.complete_with_file(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            video_path=context.case.video_path,
            temperature=temperature,
        )
    if context.frames:
        return provider.complete_with_frames(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            frames=context.frames,
            temperature=temperature,
        )
    if context.video_data_url:
        return provider.complete_with_video(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            video_data_url=context.video_data_url,
            video_fps=context.video_fps,
            temperature=temperature,
        )
    return provider.complete(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temperature,
    )
