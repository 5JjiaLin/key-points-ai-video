from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .models import ManifestCase, to_jsonable


@dataclass(frozen=True)
class TaskSpec:
    task_type: str
    case_id: str
    video_id: str
    title: str
    runs: int
    input: dict[str, Any]
    stages: list[str] = field(
        default_factory=lambda: [
            "classification",
            "knowledge_points",
            "cards",
            "audit",
            "quality_summary",
        ]
    )
    output_contract: dict[str, Any] = field(
        default_factory=lambda: {
            "knowledge_points": "array[KnowledgePoint]",
            "cards": "array[RecoveryCard]",
            "audit": "object",
            "quality_summary": "object",
        }
    )
    quality_gates: dict[str, Any] = field(
        default_factory=lambda: {
            "knowledge_point_overlap": "hard_fail",
            "card_rule_hard_failures": "hard_fail",
            "llm_audit_hard_failures": "hard_fail",
            "passed_card_required": True,
        }
    )

    @classmethod
    def from_case(cls, case: ManifestCase, *, runs: int) -> "TaskSpec":
        return cls(
            task_type="video_to_recovery_cards",
            case_id=case.case_id,
            video_id=case.video_id,
            title=case.title,
            runs=runs,
            input={
                "video_path": str(case.video_path),
                "duration_seconds": case.duration_seconds,
                "language": case.language,
                "sidecar_text_path": str(case.sidecar_text_path) if case.sidecar_text_path else None,
            },
        )

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(self)
