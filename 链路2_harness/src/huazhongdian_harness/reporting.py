from __future__ import annotations

from pathlib import Path

from .io_utils import read_json, write_text
from .trace import TraceRecorder


def build_report(*, run_dir: str | Path) -> Path:
    root = Path(run_dir).expanduser().resolve()
    trace = TraceRecorder(root / "trace.jsonl")
    summary_path = root / "summary.json"
    if not summary_path.exists():
        raise FileNotFoundError(f"summary.json not found. Run `harness judge` first: {summary_path}")

    report_path = root / "report.md"
    with trace.tool("report.build", input_summary={"summary_path": str(summary_path)}, output_path=report_path):
        summary = read_json(summary_path)
        lines = [
            "# 划重点出题 Harness Report",
            "",
            f"- Case count: {summary.get('case_count', 0)}",
            f"- Passed: {summary.get('passed_count', 0)}",
            f"- Failed: {summary.get('failed_count', 0)}",
            "",
            "| Case | Title | Passed | Rule | Judge | Stability | Main failures |",
            "|---|---|---:|---:|---:|---:|---|",
        ]

        for case in summary.get("cases", []):
            aggregate = case.get("aggregate", {})
            failures = aggregate.get("failure_reasons", [])
            first_failures = "; ".join(str(item) for item in failures[:3])
            lines.append(
                "| {case_id} | {title} | {passed} | {rule:.2f} | {judge:.2f} | {stability:.2f} | {failures} |".format(
                    case_id=_escape(case.get("case_id", "")),
                    title=_escape(case.get("title", "")),
                    passed="yes" if aggregate.get("passed") else "no",
                    rule=float(aggregate.get("rule_score", 0.0)),
                    judge=float(aggregate.get("judge_score", 0.0)),
                    stability=float(aggregate.get("stability_score", 0.0)),
                    failures=_escape(first_failures),
                )
            )

        lines.extend(["", "## Run Details", ""])
        for case in summary.get("cases", []):
            lines.append(f"### {case.get('case_id')} - {case.get('title')}")
            lines.append("")
            for run in case.get("runs", []):
                evaluation = run.get("evaluation", {})
                lines.append(
                    "- {run_id}: passed={passed}, rule={rule:.2f}, judge={judge:.2f}".format(
                        run_id=run.get("run_id"),
                        passed=evaluation.get("passed"),
                        rule=float(evaluation.get("rule_score", 0.0)),
                        judge=float(evaluation.get("judge_score", 0.0)),
                    )
                )
                for card in run.get("cards", []):
                    audit = _audit_label(card)
                    lines.append(
                        "  - {hook} | audit={audit}, rule={rule:.2f}, judge={judge:.2f}".format(
                            hook=card.get("hook_question"),
                            audit=audit,
                            rule=float(card.get("rule_score", 0.0)),
                            judge=float(card.get("judge_score", 0.0)),
                        )
                    )
                    suggestions = card.get("revision_suggestions") or {}
                    suggestion_bits = [
                        str(value)
                        for value in suggestions.values()
                        if value is not None and str(value).strip()
                    ]
                    if suggestion_bits:
                        lines.append(f"    - suggestions: {_escape('; '.join(suggestion_bits[:3]))}")
            lines.append("")

        write_text(report_path, "\n".join(lines).rstrip() + "\n")
    return report_path


def _escape(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def _audit_label(card: dict) -> str:
    grade = card.get("audit_grade") or "n/a"
    score = (
        card.get("audit_score")
        or card.get("audit_score_32")
        or card.get("audit_score_30")
        or card.get("audit_score_26")
    )
    score_max = card.get("audit_score_max") or (
        32
        if card.get("audit_score_32") is not None
        else 30
        if card.get("audit_score_30") is not None
        else 26
    )
    treatment = card.get("treatment") or ""
    if isinstance(score, int | float):
        label = f"{grade} ({float(score):.0f}/{float(score_max):.0f})"
    else:
        label = str(grade)
    if treatment:
        label += f", {treatment}"
    return _escape(label)
