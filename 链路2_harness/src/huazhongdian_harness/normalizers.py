from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from .json_utils import parse_json_object
from .models import CardCandidateGroup, KnowledgePoint, ModelOutputError, RecoveryCard


def parse_knowledge_points(raw: str) -> list[KnowledgePoint]:
    parsed = parse_json_object(raw)
    if isinstance(parsed, dict):
        items = parsed.get("knowledge_points") or parsed.get("items")
    else:
        items = parsed
    if not isinstance(items, list):
        raise ModelOutputError("Expected knowledge_points to be an array")
    if not items:
        raise ModelOutputError("No knowledge points returned")
    points: list[KnowledgePoint] = []
    for item in items:
        if not isinstance(item, dict):
            raise ModelOutputError("Knowledge point rows must be objects")
        points.append(KnowledgePoint.from_mapping(item))
    return points


def parse_recovery_cards(raw: str, *, default_video_id: str) -> list[RecoveryCard]:
    parsed = parse_json_object(raw)
    if isinstance(parsed, dict):
        items = parsed.get("cards") or parsed.get("recovery_cards") or parsed.get("items")
    else:
        items = parsed
    if not isinstance(items, list):
        raise ModelOutputError("Expected cards to be an array")
    if not items:
        raise ModelOutputError("No cards returned")
    cards: list[RecoveryCard] = []
    for item in items:
        if not isinstance(item, dict):
            raise ModelOutputError("Card rows must be objects")
        cards.append(RecoveryCard.from_mapping(item, default_video_id=default_video_id))
    return cards


def parse_card_candidate_groups(raw: str, *, default_video_id: str) -> list[CardCandidateGroup]:
    parsed = parse_json_object(raw)
    if isinstance(parsed, dict):
        items = parsed.get("candidate_groups") or parsed.get("groups")
    else:
        items = parsed
    if not isinstance(items, list):
        raise ModelOutputError("Expected candidate_groups to be an array")
    if not items:
        raise ModelOutputError("No candidate groups returned")
    groups: list[CardCandidateGroup] = []
    for item in items:
        if not isinstance(item, dict):
            raise ModelOutputError("Candidate groups must be objects")
        groups.append(CardCandidateGroup.from_mapping(item, default_video_id=default_video_id))
    knowledge_point_ids = [group.knowledge_point_id for group in groups]
    if len(set(knowledge_point_ids)) != len(knowledge_point_ids):
        raise ModelOutputError("candidate_groups contains duplicate knowledge_point_id values")
    return groups


@dataclass(frozen=True)
class JudgeAudit:
    scores: dict[str, float]
    overall_score: float
    failure_reasons: list[str]
    audit_score: float | None = None
    audit_score_max: float = 32
    audit_score_32: float | None = None
    audit_score_30: float | None = None
    audit_score_26: float | None = None
    audit_grade: str = ""
    treatment: str = ""
    should_keep: bool | None = None
    main_issues: list[str] = field(default_factory=list)
    blocking_reasons: list[str] = field(default_factory=list)
    revision_suggestions: dict[str, Any] = field(default_factory=dict)


def parse_judge_audit(raw: str) -> JudgeAudit:
    parsed = parse_json_object(raw)
    if not isinstance(parsed, dict):
        raise ModelOutputError("Judge output must be an object")

    raw_scores = parsed.get("scores")
    if not isinstance(raw_scores, dict):
        raise ModelOutputError("Judge output missing scores object")
    scores = {str(key): _score(value, f"scores.{key}") for key, value in raw_scores.items()}

    audit_score_max = 32.0
    audit_score = parsed.get("audit_score_32")
    audit_score_32 = None
    audit_score_30 = None
    audit_score_26 = None
    if audit_score is not None:
        audit_score_32 = _score_with_max(audit_score, "audit_score_32", 32)
        normalized_audit_score = audit_score_32
    elif parsed.get("audit_score_30") is not None:
        audit_score_max = 30.0
        audit_score = parsed.get("audit_score_30")
        audit_score_30 = _score_with_max(audit_score, "audit_score_30", 30)
        normalized_audit_score = audit_score_30
    elif parsed.get("audit_score_26") is not None:
        audit_score_max = 26.0
        audit_score_26 = _score_with_max(parsed.get("audit_score_26"), "audit_score_26", 26)
        normalized_audit_score = audit_score_26
    elif parsed.get("audit_score") is not None:
        normalized_audit_score = _score_with_max(parsed.get("audit_score"), "audit_score", 30)
    else:
        normalized_audit_score = None

    overall_raw = parsed.get("overall_score")
    if overall_raw is None and normalized_audit_score is not None:
        overall = round(normalized_audit_score / audit_score_max * 5, 2)
    else:
        overall = _score(overall_raw, "overall_score")

    failure_reasons = _string_list(parsed.get("failure_reasons", []), "failure_reasons")
    main_issues = _string_list(parsed.get("main_issues", []), "main_issues")
    blocking_reasons = _string_list(parsed.get("blocking_reasons", []), "blocking_reasons")
    reasons = failure_reasons + main_issues + blocking_reasons

    should_keep = parsed.get("should_keep")
    if should_keep is not None and not isinstance(should_keep, bool):
        raise ModelOutputError("should_keep must be boolean when present")

    suggestions = parsed.get("revision_suggestions", {})
    if not isinstance(suggestions, dict):
        raise ModelOutputError("revision_suggestions must be an object")

    return JudgeAudit(
        scores=scores,
        overall_score=overall,
        failure_reasons=[reason for reason in reasons if reason.strip()],
        audit_score=normalized_audit_score,
        audit_score_max=audit_score_max,
        audit_score_32=audit_score_32,
        audit_score_30=audit_score_30,
        audit_score_26=audit_score_26,
        audit_grade=str(parsed.get("audit_grade", "")),
        treatment=str(parsed.get("treatment", "")),
        should_keep=should_keep,
        main_issues=main_issues,
        blocking_reasons=blocking_reasons,
        revision_suggestions=suggestions,
    )


@dataclass(frozen=True)
class CandidateGroupAudit:
    knowledge_point_id: str
    ranking: list[str]
    selected_candidate_id: str
    candidate_audits: dict[str, JudgeAudit]


def parse_candidate_group_audit(raw: str) -> CandidateGroupAudit:
    parsed = parse_json_object(raw)
    if not isinstance(parsed, dict):
        raise ModelOutputError("Candidate group audit must be an object")
    knowledge_point_id = str(parsed.get("knowledge_point_id") or "").strip()
    if not knowledge_point_id:
        raise ModelOutputError("Candidate group audit missing knowledge_point_id")
    ranking = _string_list(parsed.get("candidate_ranking", []), "candidate_ranking")
    if len(ranking) != 3 or len(set(ranking)) != 3:
        raise ModelOutputError("candidate_ranking must contain 3 unique candidate ids")
    selected_candidate_id = str(parsed.get("selected_candidate_id") or "").strip()
    if selected_candidate_id not in ranking:
        raise ModelOutputError("selected_candidate_id must appear in candidate_ranking")
    if ranking[0] != selected_candidate_id:
        raise ModelOutputError("selected_candidate_id must be first in candidate_ranking")
    raw_audits = parsed.get("candidate_audits")
    if not isinstance(raw_audits, list) or len(raw_audits) != 3:
        raise ModelOutputError("candidate_audits must contain exactly 3 rows")
    audits: dict[str, JudgeAudit] = {}
    for row in raw_audits:
        if not isinstance(row, dict):
            raise ModelOutputError("candidate_audits rows must be objects")
        candidate_id = str(row.get("candidate_id") or row.get("card_id") or "").strip()
        if not candidate_id or candidate_id in audits:
            raise ModelOutputError("candidate_audits candidate_id values must be unique")
        audits[candidate_id] = parse_judge_audit(json.dumps(row, ensure_ascii=False))
    if set(audits) != set(ranking):
        raise ModelOutputError("candidate_audits ids must match candidate_ranking")
    return CandidateGroupAudit(
        knowledge_point_id=knowledge_point_id,
        ranking=ranking,
        selected_candidate_id=selected_candidate_id,
        candidate_audits=audits,
    )


def parse_candidate_group_audits(raw: str) -> list[CandidateGroupAudit]:
    parsed = parse_json_object(raw)
    rows = parsed.get("group_audits") if isinstance(parsed, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ModelOutputError("group_audits must be a non-empty array")
    audits = [
        parse_candidate_group_audit(json.dumps(row, ensure_ascii=False))
        for row in rows
        if isinstance(row, dict)
    ]
    if len(audits) != len(rows):
        raise ModelOutputError("group_audits rows must be objects")
    knowledge_point_ids = [audit.knowledge_point_id for audit in audits]
    if len(set(knowledge_point_ids)) != len(knowledge_point_ids):
        raise ModelOutputError("group_audits knowledge_point_id values must be unique")
    return audits


def parse_judge_output(raw: str) -> tuple[dict[str, float], float, list[str]]:
    audit = parse_judge_audit(raw)
    return audit.scores, audit.overall_score, audit.failure_reasons


def _score(value: Any, field_name: str) -> float:
    return _score_with_max(value, field_name, 5)


def _score_with_max(value: Any, field_name: str, max_value: float) -> float:
    if not isinstance(value, int | float):
        raise ModelOutputError(f"{field_name} must be numeric")
    score = float(value)
    if score < 0 or score > max_value:
        raise ModelOutputError(f"{field_name} must be between 0 and {max_value:g}")
    return score


def _string_list(value: Any, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise ModelOutputError(f"{field_name} must be an array")
    return [str(reason) for reason in value if str(reason).strip()]
