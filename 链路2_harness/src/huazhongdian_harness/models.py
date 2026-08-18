from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from pathlib import Path
from typing import Any


class HarnessError(Exception):
    """Base class for expected harness failures."""


class ManifestError(HarnessError):
    """Raised when a manifest row is invalid."""


class IngestionError(HarnessError):
    """Raised when a video case cannot provide usable source text."""


class ModelOutputError(HarnessError):
    """Raised when an LLM response cannot be normalized."""


def _required_str(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ManifestError(f"Missing required string field: {key}")
    return value.strip()


def _required_number(data: dict[str, Any], key: str) -> float:
    value = data.get(key)
    if not isinstance(value, int | float):
        raise ManifestError(f"Missing required numeric field: {key}")
    return float(value)


def _coerce_float(value: Any, field_name: str) -> float:
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError as exc:
            raise ModelOutputError(f"{field_name} must be numeric") from exc
    raise ModelOutputError(f"{field_name} must be numeric")


def _coerce_bool(value: Any, field_name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "1", "是"}:
            return True
        if normalized in {"false", "no", "0", "否"}:
            return False
    raise ModelOutputError(f"{field_name} must be boolean")


@dataclass(frozen=True)
class ManifestCase:
    case_id: str
    video_id: str
    video_path: Path
    title: str
    duration_seconds: float
    language: str
    sidecar_text_path: Path | None = None
    source_line: int = 0

    @classmethod
    def from_json(
        cls,
        data: dict[str, Any],
        *,
        base_dir: Path,
        source_line: int,
    ) -> "ManifestCase":
        sidecar = data.get("sidecar_text_path")
        sidecar_path = None
        if sidecar is not None:
            if not isinstance(sidecar, str) or not sidecar.strip():
                raise ManifestError("sidecar_text_path must be a non-empty string when present")
            sidecar_path = _resolve_path(base_dir, sidecar)

        return cls(
            case_id=_required_str(data, "case_id"),
            video_id=_required_str(data, "video_id"),
            video_path=_resolve_path(base_dir, _required_str(data, "video_path")),
            title=_required_str(data, "title"),
            duration_seconds=_required_number(data, "duration_seconds"),
            language=_required_str(data, "language"),
            sidecar_text_path=sidecar_path,
            source_line=source_line,
        )


@dataclass(frozen=True)
class VideoFrame:
    timestamp_seconds: float
    image_data_url: str


@dataclass(frozen=True)
class VideoContext:
    case: ManifestCase
    source_text: str = ""
    video_data_url: str | None = None
    video_fps: float = 1.0
    frames: list[VideoFrame] = field(default_factory=list)
    use_file_api: bool = False

    @property
    def has_video_input(self) -> bool:
        return self.video_data_url is not None

    @property
    def has_frame_input(self) -> bool:
        return bool(self.frames)

    @property
    def has_file_input(self) -> bool:
        return self.use_file_api

    @property
    def has_visual_input(self) -> bool:
        return self.has_video_input or self.has_frame_input or self.has_file_input


@dataclass(frozen=True)
class KnowledgePoint:
    knowledge_point_id: str
    statement: str
    start_time: float
    end_time: float
    selection_scores: dict[str, int] = field(default_factory=dict)
    priority: str = ""
    task_type: str = ""
    timestamp_note: str = ""
    tension_triad: dict[str, str] = field(default_factory=dict)
    question_direction: str = ""
    answer_core: str = ""
    answer_hook: str = ""
    evidence_segment_ids: list[str] = field(default_factory=list)

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> "KnowledgePoint":
        try:
            kp_id = _first_text(data, "knowledge_point_id", "id")
            statement = _first_text(data, "statement", "knowledge_point", "fact")
            start_time = _coerce_float(_first_value(data, "start_time", "source_start_time"), "start_time")
            end_time = _coerce_float(_first_value(data, "end_time", "source_end_time"), "end_time")
        except KeyError as exc:
            raise ModelOutputError(f"KnowledgePoint missing field: {exc.args[0]}") from exc

        raw_scores = data.get("selection_scores", {})
        if not isinstance(raw_scores, dict):
            raise ModelOutputError("selection_scores must be an object")
        scores: dict[str, int] = {}
        for key, value in raw_scores.items():
            if isinstance(value, bool):
                scores[str(key)] = int(value)
            elif isinstance(value, int | float):
                scores[str(key)] = int(value)
            else:
                raise ModelOutputError("selection_scores values must be numeric")

        priority = data.get("priority", "")
        task_type = data.get("task_type", "")
        timestamp_note = data.get("timestamp_note") or data.get("location_note") or data.get("positioning_note") or ""
        raw_triad = data.get("tension_triad", {})
        if raw_triad is None:
            raw_triad = {}
        if not isinstance(raw_triad, dict):
            raise ModelOutputError("tension_triad must be an object")
        tension_triad = {
            str(key): str(value).strip()
            for key, value in raw_triad.items()
            if str(value).strip()
        }
        return cls(
            knowledge_point_id=kp_id,
            statement=statement,
            start_time=start_time,
            end_time=end_time,
            selection_scores=scores,
            priority=str(priority),
            task_type=str(task_type),
            timestamp_note=str(timestamp_note),
            tension_triad=tension_triad,
            question_direction=str(data.get("question_direction") or "").strip(),
            answer_core=str(data.get("answer_core") or "").strip(),
            answer_hook=str(data.get("answer_hook") or "").strip(),
            evidence_segment_ids=[
                str(value)
                for value in (data.get("evidence_segment_ids") or [])
                if str(value).strip()
            ],
        )


@dataclass(frozen=True)
class RecoveryCard:
    video_id: str
    card_id: str
    knowledge_point_id: str
    hook_question: str
    highlight_answer: str
    source_start_time: float
    source_end_time: float
    video_entry_text: str
    video_cta_text: str
    card_type: str
    theme: str
    difficulty_level: str
    risk_level: str
    curiosity_score: float
    is_suitable_for_card: bool
    question_style: str = ""
    candidate_index: int | None = None
    self_score: float | None = None

    @classmethod
    def from_mapping(cls, data: dict[str, Any], *, default_video_id: str) -> "RecoveryCard":
        try:
            candidate_index = data.get("candidate_index")
            if candidate_index is not None and not isinstance(candidate_index, int):
                raise ModelOutputError("candidate_index must be an integer when present")
            self_score = data.get("self_score")
            if self_score is not None:
                self_score = _coerce_float(self_score, "self_score")
            return cls(
                video_id=str(data.get("video_id") or default_video_id),
                card_id=_first_text(data, "card_id", "id"),
                knowledge_point_id=_first_text(data, "knowledge_point_id"),
                hook_question=_first_text(data, "hook_question", "question"),
                highlight_answer=_first_text(data, "highlight_answer", "answer"),
                source_start_time=_coerce_float(
                    _first_value(data, "source_start_time", "start_time"),
                    "source_start_time",
                ),
                source_end_time=_coerce_float(
                    _first_value(data, "source_end_time", "end_time"),
                    "source_end_time",
                ),
                video_entry_text=_first_text(data, "video_entry_text"),
                video_cta_text=_first_text(data, "video_cta_text"),
                card_type=_first_text(data, "card_type"),
                theme=_first_text(data, "theme"),
                difficulty_level=_first_text(data, "difficulty_level"),
                risk_level=_first_text(data, "risk_level"),
                curiosity_score=_coerce_float(data.get("curiosity_score"), "curiosity_score"),
                is_suitable_for_card=_coerce_bool(
                    data.get("is_suitable_for_card"),
                    "is_suitable_for_card",
                ),
                question_style=str(data.get("question_style", "")),
                candidate_index=candidate_index,
                self_score=self_score,
            )
        except KeyError as exc:
            raise ModelOutputError(f"RecoveryCard missing field: {exc.args[0]}") from exc


@dataclass(frozen=True)
class CardCandidateGroup:
    knowledge_point_id: str
    candidates: list[RecoveryCard]

    @classmethod
    def from_mapping(cls, data: dict[str, Any], *, default_video_id: str) -> "CardCandidateGroup":
        knowledge_point_id = _first_text(data, "knowledge_point_id")
        raw_candidates = data.get("candidates")
        if not isinstance(raw_candidates, list):
            raise ModelOutputError("Candidate group candidates must be an array")
        candidates = [
            RecoveryCard.from_mapping(item, default_video_id=default_video_id)
            for item in raw_candidates
            if isinstance(item, dict)
        ]
        if len(candidates) != len(raw_candidates):
            raise ModelOutputError("Candidate group rows must be objects")
        if len(candidates) != 3:
            raise ModelOutputError(
                f"Candidate group {knowledge_point_id} must contain exactly 3 candidates"
            )
        if any(card.knowledge_point_id != knowledge_point_id for card in candidates):
            raise ModelOutputError(
                f"Candidate group {knowledge_point_id} contains a card for another knowledge point"
            )
        card_ids = [card.card_id for card in candidates]
        if len(set(card_ids)) != 3:
            raise ModelOutputError(f"Candidate group {knowledge_point_id} card_id values must be unique")
        hooks = [card.hook_question.strip() for card in candidates]
        if len(set(hooks)) != 3:
            raise ModelOutputError(f"Candidate group {knowledge_point_id} hooks must be distinct")
        return cls(knowledge_point_id=knowledge_point_id, candidates=candidates)


@dataclass(frozen=True)
class EvaluationResult:
    schema_valid: bool
    rule_score: float
    judge_score: float
    stability_score: float
    passed: bool
    failure_reasons: list[str] = field(default_factory=list)


def to_jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return to_jsonable(asdict(value))
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_jsonable(v) for v in value]
    return value


def _resolve_path(base_dir: Path, raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def _first_text(data: dict[str, Any], *keys: str) -> str:
    value = _first_value(data, *keys)
    if not isinstance(value, str) or not value.strip():
        raise KeyError(keys[0])
    return value.strip()


def _first_value(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    raise KeyError(keys[0])
