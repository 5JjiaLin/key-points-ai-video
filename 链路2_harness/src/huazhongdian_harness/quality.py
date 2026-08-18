from __future__ import annotations

from typing import Any


def build_backend_quality_summary(*, cards: list[dict[str, Any]], audit: dict[str, Any]) -> dict[str, Any]:
    audit_by_id = {
        str(item.get("card_id")): item
        for item in audit.get("cards") or []
        if isinstance(item, dict) and item.get("card_id")
    }
    rows = []
    passed_ids: list[str] = []
    final_failed_ids: list[str] = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        card_id = str(card.get("card_id") or "")
        audit_row = audit_by_id.get(card_id, {})
        reasons = _combined_reasons(audit_row)
        passed = audit_row.get("passed") is True
        if passed:
            passed_ids.append(card_id)
        if audit_row.get("final_failed") is True and card_id:
            final_failed_ids.append(card_id)
        rows.append(
            {
                "card_id": card_id,
                "knowledge_point_id": card.get("knowledge_point_id"),
                "hook_question": card.get("hook_question"),
                "passed": passed,
                "attempt_count": audit_row.get("attempt_count"),
                "final_failed": audit_row.get("final_failed") is True,
                "rule_score": audit_row.get("rule_score"),
                "judge_score": audit_row.get("judge_score"),
                "audit_grade": audit_row.get("audit_grade"),
                "failure_reasons": reasons,
                "hard_failure_reasons": audit_row.get("hard_failure_reasons") or [],
            }
        )
    return {
        "passed_card_ids": passed_ids,
        "failed_card_ids": [row["card_id"] for row in rows if row["card_id"] and not row["passed"]],
        "final_failed_card_ids": final_failed_ids,
        "best_card_id": passed_ids[0] if passed_ids else None,
        "knowledge_point_rule": audit.get("knowledge_point_rule", {}),
        "cards": rows,
    }


def build_harness_quality_summary(case_summary: dict[str, Any]) -> dict[str, Any]:
    run_rows = []
    for run in case_summary.get("runs", []):
        cards = [card for card in run.get("cards", []) if isinstance(card, dict)]
        passed_cards = [card for card in cards if card.get("passed") is True]
        evaluation = run.get("evaluation", {})
        run_rows.append(
            {
                "run_id": run.get("run_id"),
                "passed": evaluation.get("passed") is True,
                "passed_card_count": len(passed_cards),
                "judge_score": float(evaluation.get("judge_score") or 0.0),
                "rule_score": float(evaluation.get("rule_score") or 0.0),
                "failure_reasons": evaluation.get("failure_reasons") or [],
                "passed_card_ids": [card.get("card_id") for card in passed_cards if card.get("card_id")],
            }
        )
    best = None
    if run_rows:
        best = max(
            run_rows,
            key=lambda row: (
                row["passed"],
                row["passed_card_count"],
                row["judge_score"],
                row["rule_score"],
            ),
        )
    return {
        "case_id": case_summary.get("case_id"),
        "best_run_id": best.get("run_id") if best else None,
        "best_passed_card_ids": best.get("passed_card_ids") if best else [],
        "runs": run_rows,
    }


def _combined_reasons(audit_row: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    for key in ("rule_failure_reasons", "failure_reasons", "hard_failure_reasons"):
        values = audit_row.get(key) or []
        if isinstance(values, list):
            reasons.extend(str(item) for item in values if str(item).strip())
    return sorted(set(reasons))
