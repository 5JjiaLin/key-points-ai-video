from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, replace
from pathlib import Path

from .ingestion import VideoContext
from .io_utils import read_json, write_json
from .model_json import parse_with_optional_repair
from .models import CardCandidateGroup, EvaluationResult, KnowledgePoint, ManifestCase, RecoveryCard
from .normalizers import (
    CandidateGroupAudit,
    JudgeAudit,
    parse_card_candidate_groups,
    parse_candidate_group_audit,
    parse_judge_audit,
)
from .prompts import (
    build_candidate_group_judge_prompt,
    build_candidate_group_regeneration_prompt,
    build_judge_prompt,
)
from .providers import LLMProvider
from .quality import build_harness_quality_summary
from .trace import TraceRecorder


LOW_VALUE_HOOK_TERMS = [
    "核心步骤",
    "方法论",
    "知识体系",
    "策略",
    "机制解析",
    "深度解析",
    "全面了解",
    "如何进行",
    "怎样才能不着痕迹",
    "为什么特殊",
    "有什么特点",
    "为什么重要",
    "有什么地理特征",
    "代表什么",
    "是什么",
]

TRAINING_TONE_TERMS = [
    "赋能",
    "闭环",
    "抓手",
    "认知升级",
    "价值共创",
    "利益诉求",
    "个人意志",
    "操控",
]

EXAM_HOOK_TERMS = [
    "是哪个",
    "位于哪里",
    "有多少",
    "分别有哪些",
    "被哪几个",
    "我国唯一",
]

CLICKBAIT_TERMS = [
    "毁灭级",
    "恐怖",
    "震惊",
    "彻底颠覆",
    "秒杀",
    "绝对",
    "必然",
    "全网都不知道",
    "看完吓一跳",
]

BOUNDARY_BREAKING_TERMS = [
    "一定",
    "必须",
    "完全",
    "绝对",
    "唯一",
    "毁天灭地",
    "秒杀",
    "碾压",
    "彻底解决",
]

TASK_TYPES = {
    "原因解释型",
    "误区纠正型",
    "影响结果型",
    "过程变化型",
    "信号识别型",
    "方法决策型",
    "作用说明型",
    "关系结构型",
    "尺度反差型",
    "对比差异型",
}

QUESTION_STYLES = {
    *TASK_TYPES,
    "干货解释型",
    "反差吸引型",
    "信号识别型",
    "关系解释型",
    "自然现象型",
    "交易避坑型",
    "能源产业 / 资源约束型",
    "抽象概念 / 社会经济型",
}

VIDEO_GUIDANCE_TERMS = [
    "视频里有详解",
    "详细过程看视频",
    "具体看视频讲解",
    "视频里讲得更细",
    "完整原因在视频里",
    "看视频",
    "视频里讲",
    "视频里拆开讲",
    "看视频对比",
    "视频里有数据",
    "回看",
    "原视频",
    "视频中",
    "视频会",
    "视频将",
    "对应讲解",
    "对应片段",
    "继续观看",
    "点击查看",
]

PASSING_AUDIT_GRADES = {"S", "A"}
MAX_CANDIDATE_AUDIT_ATTEMPTS = 3
KNOWLEDGE_POINT_OVERLAP_TOLERANCE_SECONDS = 2.0
EXTENDED_HOOK_TASK_TYPES = {"尺度反差型", "对比差异型", "误区纠正型"}
CONCRETE_ANCHOR_TERMS = [
    "年轻人",
    "老年人",
    "痛风",
    "甜饮",
    "果糖",
    "尿酸",
    "流星",
    "陨石",
    "太阳",
    "地球",
    "月球",
    "黑洞",
    "原子弹",
    "江苏",
    "青海湖",
    "鄱阳湖",
]
MISCONCEPTION_EXAM_PATTERNS = [
    re.compile(pattern)
    for pattern in [
        r"是.+专属.+吗",
        r"属于.+吗",
        r"算不算",
        r"是什么",
    ]
]
HARD_AUDIT_DIMENSIONS = {
    "hook_readability",
    "hook_question_quality",
    "hook_no_answer_leak",
    "answer_directness",
    "answer_natural_hook",
    "qa_pairing",
    "promise_fulfillment",
    "timestamp_quality",
    "consistency",
}
HARD_RULE_REASON_PREFIXES = (
    "hook core length",
    "hook should not contain manual line breaks",
    "hook is not phrased as a question",
    "misconception hook is not phrased as user inner voice",
    "answer length",
    "answer contains video guidance",
    "answer introduces a new question",
)


@dataclass(frozen=True)
class RuleCheck:
    score: float
    failure_reasons: list[str]


def judge_harness(*, run_dir: str | Path, provider: LLMProvider) -> dict:
    root = Path(run_dir).expanduser().resolve()
    case_root = root / "cases"
    summaries = []
    trace = TraceRecorder(root / "trace.jsonl")
    if not case_root.exists():
        raise FileNotFoundError(f"No cases directory found: {case_root}")

    for case_dir in sorted(path for path in case_root.iterdir() if path.is_dir()):
        with trace.tool(
            "grader.case",
            input_summary={"case_id": case_dir.name},
            output_path=case_dir / "evaluations.json",
        ):
            case_summary = judge_case(case_dir=case_dir, provider=provider)
        write_json(case_dir / "evaluations.json", case_summary)
        write_json(case_dir / "quality_summary.json", build_harness_quality_summary(case_summary))
        summaries.append(case_summary)

    aggregate = {
        "case_count": len(summaries),
        "passed_count": sum(1 for item in summaries if item["aggregate"]["passed"]),
        "failed_count": sum(1 for item in summaries if not item["aggregate"]["passed"]),
        "cases": summaries,
    }
    write_json(root / "summary.json", aggregate)
    return aggregate


def judge_case(*, case_dir: str | Path, provider: LLMProvider) -> dict:
    case_path = Path(case_dir)
    case = _load_case(case_path / "case.json")
    source_text_path = case_path / "source_text.txt"
    source_text = source_text_path.read_text(encoding="utf-8") if source_text_path.exists() else ""
    context = VideoContext(case=case, source_text=source_text)

    run_summaries = []
    for run_dir in sorted(path for path in case_path.glob("run_*") if path.is_dir()):
        run_summaries.append(_judge_run(run_dir=run_dir, context=context, provider=provider))

    aggregate = _aggregate_case(run_summaries)
    return {
        "case_id": case.case_id,
        "video_id": case.video_id,
        "title": case.title,
        "runs": run_summaries,
        "aggregate": aggregate,
    }


def rule_check_card(card: RecoveryCard, knowledge_points: list[KnowledgePoint]) -> RuleCheck:
    score = 5.0
    reasons: list[str] = []
    hook_len = _hook_core_len(card.hook_question)
    answer_len = _visible_len(card.highlight_answer)
    segment_duration = card.source_end_time - card.source_start_time
    kp_ids = {kp.knowledge_point_id for kp in knowledge_points}

    hook_limit = 18 if _allows_extended_hook_limit(card) else 14
    if not 9 <= hook_len <= hook_limit:
        score -= 0.8
        reasons.append(f"hook core length {hook_len} outside 9-{hook_limit}")
    elif hook_len > 12:
        score -= 0.2
        reasons.append(f"hook core length {hook_len} above preferred 12")
    if "\n" in card.hook_question or "\r" in card.hook_question:
        score -= 0.3
        reasons.append("hook should not contain manual line breaks")
    if not card.hook_question.endswith(("?", "？")):
        score -= 0.4
        reasons.append("hook is not phrased as a question")
    if any(term in card.hook_question for term in LOW_VALUE_HOOK_TERMS):
        score -= 0.8
        reasons.append("hook is vague or sounds like a course title")
    if any(term in card.hook_question for term in EXAM_HOOK_TERMS):
        score -= 0.8
        reasons.append("hook sounds like an exam question")
    if any(term in card.hook_question for term in CLICKBAIT_TERMS):
        score -= 1.0
        reasons.append("hook contains clickbait wording")
    if any(term in card.hook_question for term in TRAINING_TONE_TERMS):
        score -= 0.6
        reasons.append("hook contains abstract/training-tone wording")
    if _question_count(card.hook_question) > 1:
        score -= 0.8
        reasons.append("hook asks more than one question")
    if card.question_style and card.question_style not in QUESTION_STYLES:
        score -= 0.3
        reasons.append(f"unknown question_style: {card.question_style}")
    if card.question_style == "误区纠正型" and _looks_like_concept_exam_hook(card.hook_question):
        score -= 0.9
        reasons.append("misconception hook is not phrased as user inner voice")

    if not 20 <= answer_len <= 90:
        score -= 0.8
        reasons.append(f"answer length {answer_len} outside 20-90")
    if _only_judgment(card.highlight_answer):
        score -= 1.0
        reasons.append("answer only gives a yes/no judgment")
    if any(term in card.highlight_answer for term in VIDEO_GUIDANCE_TERMS):
        score -= 1.0
        reasons.append("answer contains video guidance")
    if _question_count(card.highlight_answer) > 0:
        score -= 0.8
        reasons.append("answer introduces a new question")
    if any(term in card.highlight_answer for term in TRAINING_TONE_TERMS):
        score -= 0.6
        reasons.append("answer contains abstract/training-tone wording")
    if any(term in card.highlight_answer for term in CLICKBAIT_TERMS):
        score -= 0.8
        reasons.append("answer contains clickbait wording")

    if card.card_type != "recovery":
        score -= 1.0
        reasons.append("card_type is not recovery")
    if card.knowledge_point_id not in kp_ids:
        score -= 1.0
        reasons.append("card is not bound to a selected knowledge point")
    if card.source_start_time < 0 or card.source_end_time <= card.source_start_time:
        score -= 1.0
        reasons.append("source time range is invalid")
    elif segment_duration < 10:
        score -= 0.4
        reasons.append("source segment is shorter than 10 seconds")
    elif segment_duration > 60:
        score -= 0.8
        reasons.append("source segment is longer than 60 seconds")
    elif segment_duration > 40:
        score -= 0.3
        reasons.append("source segment is wider than recommended 40 seconds")

    if not card.is_suitable_for_card:
        score -= 1.0
        reasons.append("card is marked unsuitable")

    return RuleCheck(score=max(0.0, round(score, 2)), failure_reasons=reasons)


def hard_rule_failures(rule: RuleCheck) -> list[str]:
    return [
        reason
        for reason in rule.failure_reasons
        if reason.startswith(HARD_RULE_REASON_PREFIXES)
    ]


def hard_audit_failures(audit: JudgeAudit) -> list[str]:
    failures: list[str] = []
    for dimension in sorted(HARD_AUDIT_DIMENSIONS):
        value = audit.scores.get(dimension)
        if value is None:
            failures.append(f"judge {dimension} missing")
        elif value < 2:
            failures.append(f"judge {dimension} below 2: {value}")
    return failures


def rule_check_knowledge_points(knowledge_points: list[KnowledgePoint]) -> RuleCheck:
    if not knowledge_points:
        return RuleCheck(score=0.0, failure_reasons=["no knowledge points returned"])

    score = 5.0
    reasons: list[str] = []
    for point in knowledge_points:
        statement_len = _visible_len(point.statement)
        if point.statement.endswith(("?", "？")):
            score -= 0.7
            reasons.append(f"{point.knowledge_point_id} statement is phrased as a question")
        if not _looks_like_statement(point.statement):
            score -= 0.5
            reasons.append(f"{point.knowledge_point_id} statement may not be a complete fact sentence")
        if statement_len < 18 or statement_len > 45:
            score -= 0.4
            reasons.append(f"{point.knowledge_point_id} statement length {statement_len} outside preferred 18-45")
        if any(term in point.statement for term in BOUNDARY_BREAKING_TERMS):
            score -= 0.8
            reasons.append(f"{point.knowledge_point_id} statement contains over-absolute wording")
        if point.task_type not in TASK_TYPES:
            score -= 0.5
            reasons.append(f"{point.knowledge_point_id} missing or unknown task_type")
        if not point.timestamp_note.strip():
            score -= 0.6
            reasons.append(f"{point.knowledge_point_id} missing timestamp_note")

        duration = point.end_time - point.start_time
        if point.start_time < 0 or point.end_time <= point.start_time:
            score -= 1.0
            reasons.append(f"{point.knowledge_point_id} has invalid time range")
        elif duration < 8:
            score -= 0.3
            reasons.append(f"{point.knowledge_point_id} segment shorter than 8 seconds")
        elif duration > 60:
            score -= 1.0
            reasons.append(f"{point.knowledge_point_id} segment longer than 60 seconds")
        elif duration > 45:
            score -= 0.5
            reasons.append(f"{point.knowledge_point_id} segment longer than 45 seconds")
        elif duration > 35:
            score -= 0.2
            reasons.append(f"{point.knowledge_point_id} segment longer than preferred 35 seconds")

    sorted_points = sorted(knowledge_points, key=lambda point: (point.start_time, point.end_time))
    for previous, current in zip(sorted_points, sorted_points[1:]):
        overlap_seconds = previous.end_time - current.start_time
        if overlap_seconds > KNOWLEDGE_POINT_OVERLAP_TOLERANCE_SECONDS:
            score -= 1.5
            reasons.append(
                f"{current.knowledge_point_id} overlaps {previous.knowledge_point_id} by {round(overlap_seconds, 2)} seconds"
            )

    return RuleCheck(score=max(0.0, round(score, 2)), failure_reasons=sorted(set(reasons)))


def _judge_run(*, run_dir: Path, context: VideoContext, provider: LLMProvider) -> dict:
    run_id = run_dir.name
    error_file = run_dir / "errors.json"
    if error_file.exists():
        evaluation = EvaluationResult(
            schema_valid=False,
            rule_score=0.0,
            judge_score=0.0,
            stability_score=0.0,
            passed=False,
            failure_reasons=[read_json(error_file).get("message", "run failed")],
        )
        return {"run_id": run_id, "cards": [], "evaluation": _eval_dict(evaluation)}

    try:
        knowledge_points = [
            KnowledgePoint.from_mapping(item) for item in read_json(run_dir / "knowledge_points.json")
        ]
        candidate_path = run_dir / "card_candidates.json"
        if candidate_path.exists():
            candidate_groups = parse_card_candidate_groups(
                json.dumps({"candidate_groups": read_json(candidate_path)}, ensure_ascii=False),
                default_video_id=context.case.video_id,
            )
            return _judge_candidate_run(
                run_dir=run_dir,
                context=context,
                knowledge_points=knowledge_points,
                candidate_groups=candidate_groups,
                provider=provider,
            )
        cards = [
            RecoveryCard.from_mapping(item, default_video_id=context.case.video_id)
            for item in read_json(run_dir / "cards.json")
        ]
    except Exception as exc:
        evaluation = EvaluationResult(
            schema_valid=False,
            rule_score=0.0,
            judge_score=0.0,
            stability_score=0.0,
            passed=False,
            failure_reasons=[f"schema load failed: {exc}"],
        )
        return {"run_id": run_id, "cards": [], "evaluation": _eval_dict(evaluation)}

    card_summaries = []
    rule_scores = []
    judge_scores = []
    all_reasons: list[str] = []
    kp_rules = rule_check_knowledge_points(knowledge_points)
    rule_scores.append(kp_rules.score)
    all_reasons.extend(kp_rules.failure_reasons)
    for card in cards:
        rules = rule_check_card(card, knowledge_points)
        rule_scores.append(rules.score)
        judge_audit = judge_card(
            context=context,
            knowledge_points=knowledge_points,
            card=card,
            provider=provider,
        )
        judge_score = judge_audit.overall_score
        judge_reasons = list(judge_audit.failure_reasons)
        if judge_audit.audit_grade and judge_audit.audit_grade not in PASSING_AUDIT_GRADES:
            judge_reasons.append(f"audit grade {judge_audit.audit_grade} requires rework")
        if judge_audit.should_keep is False:
            judge_reasons.append("audit marked should_keep=false")
        judge_scores.append(judge_score)
        hard_failures = hard_rule_failures(rules) + hard_audit_failures(judge_audit)
        reasons = sorted(set(rules.failure_reasons + judge_reasons + hard_failures))
        card_passed = (
            card.is_suitable_for_card
            and rules.score >= 3.5
            and judge_score >= 3.5
            and not hard_failures
            and (not judge_audit.audit_grade or judge_audit.audit_grade in PASSING_AUDIT_GRADES)
            and judge_audit.should_keep is not False
        )
        all_reasons.extend(reasons)
        card_summaries.append(
            {
                "card_id": card.card_id,
                "hook_question": card.hook_question,
                "question_style": card.question_style,
                "is_suitable_for_card": card.is_suitable_for_card,
                "rule_score": rules.score,
                "judge_score": judge_score,
                "audit_score": judge_audit.audit_score,
                "audit_score_max": judge_audit.audit_score_max,
                "audit_score_32": judge_audit.audit_score_32,
                "audit_score_30": judge_audit.audit_score_30,
                "audit_score_26": judge_audit.audit_score_26,
                "audit_grade": judge_audit.audit_grade,
                "treatment": judge_audit.treatment,
                "revision_suggestions": judge_audit.revision_suggestions,
                "passed": card_passed,
                "failure_reasons": reasons,
            }
        )

    run_rule_score = _avg(rule_scores)
    run_judge_score = _avg(judge_scores)
    has_passed_card = any(card["passed"] for card in card_summaries)
    if not has_passed_card:
        all_reasons.append("run has no passed recovery card")
    evaluation = EvaluationResult(
        schema_valid=True,
        rule_score=run_rule_score,
        judge_score=run_judge_score,
        stability_score=0.0,
        passed=has_passed_card and run_rule_score >= 3.5 and run_judge_score >= 3.5,
        failure_reasons=sorted(set(all_reasons)),
    )
    return {"run_id": run_id, "cards": card_summaries, "evaluation": _eval_dict(evaluation)}


def _judge_candidate_run(
    *,
    run_dir: Path,
    context: VideoContext,
    knowledge_points: list[KnowledgePoint],
    candidate_groups: list[CardCandidateGroup],
    provider: LLMProvider,
) -> dict:
    knowledge_by_id = {point.knowledge_point_id: point for point in knowledge_points}
    kp_rules = rule_check_knowledge_points(knowledge_points)
    rule_scores = [kp_rules.score]
    judge_scores: list[float] = []
    all_reasons = list(kp_rules.failure_reasons)
    card_summaries = []
    final_cards = []
    raw_audits = []
    raw_rewrites = []

    for group_index, original_group in enumerate(candidate_groups, start=1):
        knowledge_point = knowledge_by_id.get(original_group.knowledge_point_id)
        if knowledge_point is None:
            raise ValueError(f"Missing knowledge point for {original_group.knowledge_point_id}")
        current_group = original_group
        attempts = []
        selected_card = None
        selected_row = None
        for attempt_number in range(1, MAX_CANDIDATE_AUDIT_ATTEMPTS + 1):
            group_audit, raw = judge_candidate_group_with_raw(
                context=context,
                knowledge_point=knowledge_point,
                group=current_group,
                provider=provider,
            )
            raw_audits.append(
                {
                    "knowledge_point_id": current_group.knowledge_point_id,
                    "attempt": attempt_number,
                    "content": raw,
                }
            )
            cards_by_id = {card.card_id: card for card in current_group.candidates}
            candidate_rows = []
            for candidate_id in group_audit.ranking:
                card = cards_by_id[candidate_id]
                judge = group_audit.candidate_audits[candidate_id]
                rules = rule_check_card(card, knowledge_points)
                hard_failures = hard_rule_failures(rules) + hard_audit_failures(judge)
                passed = (
                    card.is_suitable_for_card
                    and rules.score >= 3.5
                    and judge.overall_score >= 3.5
                    and not hard_failures
                    and (not judge.audit_grade or judge.audit_grade in PASSING_AUDIT_GRADES)
                    and judge.should_keep is not False
                )
                row = {
                    "candidate_id": candidate_id,
                    "rule_score": rules.score,
                    "rule_failure_reasons": rules.failure_reasons,
                    "judge_score": judge.overall_score,
                    "audit_score": judge.audit_score,
                    "audit_score_max": judge.audit_score_max,
                    "audit_score_32": judge.audit_score_32,
                    "audit_score_30": judge.audit_score_30,
                    "audit_score_26": judge.audit_score_26,
                    "audit_grade": judge.audit_grade,
                    "treatment": judge.treatment,
                    "should_keep": judge.should_keep,
                    "hard_failure_reasons": hard_failures,
                    "failure_reasons": judge.failure_reasons,
                    "revision_suggestions": judge.revision_suggestions,
                    "passed": passed,
                }
                candidate_rows.append(row)
                if selected_card is None and passed:
                    selected_card = card
                    selected_row = row
            attempt_row = {
                "attempt": attempt_number,
                "candidate_ranking": group_audit.ranking,
                "selected_candidate_id": selected_card.card_id if selected_card else None,
                "candidate_audits": candidate_rows,
                "passed": selected_card is not None,
            }
            attempts.append(attempt_row)
            if selected_card is not None:
                break
            if attempt_number == MAX_CANDIDATE_AUDIT_ATTEMPTS:
                selected_card = current_group.candidates[0]
                selected_row = candidate_rows[0]
                break
            failure_reasons = sorted(
                {
                    str(reason)
                    for row in candidate_rows
                    for key in [
                        "rule_failure_reasons",
                        "failure_reasons",
                        "hard_failure_reasons",
                    ]
                    for reason in row[key]
                    if str(reason).strip()
                }
            )
            raw_rewrite = _complete_model(
                provider=provider,
                context=context,
                system_prompt="你是严格输出 JSON 的划重点三候选重写器。",
                user_prompt=build_candidate_group_regeneration_prompt(
                    context,
                    knowledge_point,
                    current_group,
                    failure_reasons,
                    attempt_number=attempt_number + 1,
                    max_attempts=MAX_CANDIDATE_AUDIT_ATTEMPTS,
                ),
                temperature=0.5,
            )
            parsed_rewrite = parse_with_optional_repair(
                raw=raw_rewrite,
                parser=lambda value: parse_card_candidate_groups(
                    value,
                    default_video_id=context.case.video_id,
                ),
                provider=provider,
                expected_schema='{"candidate_groups":[{"knowledge_point_id":"kp_001","candidates":[...]}]}',
                stage=f"candidate_group_rewrite:{current_group.knowledge_point_id}",
            )
            replacement = next(
                (
                    group
                    for group in parsed_rewrite.value
                    if group.knowledge_point_id == current_group.knowledge_point_id
                ),
                parsed_rewrite.value[0],
            )
            current_group = CardCandidateGroup(
                knowledge_point_id=original_group.knowledge_point_id,
                candidates=[
                    replace(
                        card,
                        video_id=original_group.candidates[index].video_id,
                        card_id=original_group.candidates[index].card_id,
                        knowledge_point_id=original_group.knowledge_point_id,
                    )
                    for index, card in enumerate(replacement.candidates)
                ],
            )
            raw_rewrites.append(
                {
                    "knowledge_point_id": current_group.knowledge_point_id,
                    "from_attempt": attempt_number,
                    "to_attempt": attempt_number + 1,
                    "content": parsed_rewrite.raw,
                }
            )

        assert selected_card is not None and selected_row is not None
        final_card = replace(selected_card, card_id=f"card_{group_index:03d}")
        final_cards.append(final_card)
        rule_scores.append(float(selected_row["rule_score"]))
        judge_scores.append(float(selected_row["judge_score"]))
        card_passed = bool(selected_row["passed"])
        reasons = sorted(
            set(
                selected_row["rule_failure_reasons"]
                + selected_row["failure_reasons"]
                + selected_row["hard_failure_reasons"]
            )
        )
        all_reasons.extend(reasons)
        card_summaries.append(
            {
                "card_id": final_card.card_id,
                "knowledge_point_id": original_group.knowledge_point_id,
                "selected_candidate_id": selected_card.card_id,
                "candidate_ranking": attempts[-1]["candidate_ranking"],
                "candidate_audits": attempts[-1]["candidate_audits"],
                "attempt_count": len(attempts),
                "attempts": attempts,
                "hook_question": final_card.hook_question,
                "question_style": final_card.question_style,
                "is_suitable_for_card": final_card.is_suitable_for_card,
                **{
                    key: selected_row.get(key)
                    for key in [
                        "rule_score",
                        "judge_score",
                        "audit_score",
                        "audit_score_max",
                        "audit_score_32",
                        "audit_score_30",
                        "audit_score_26",
                        "audit_grade",
                        "treatment",
                        "revision_suggestions",
                    ]
                },
                "passed": card_passed,
                "final_failed": not card_passed,
                "failure_reasons": reasons,
            }
        )

    write_json(run_dir / "cards.json", final_cards)
    write_json(
        run_dir / "candidate_audit.json",
        {"cards": card_summaries, "raw_audits": raw_audits, "raw_rewrites": raw_rewrites},
    )
    run_rule_score = _avg(rule_scores)
    run_judge_score = _avg(judge_scores)
    has_passed_card = any(card["passed"] for card in card_summaries)
    if not has_passed_card:
        all_reasons.append("run has no passed recovery card")
    return {
        "run_id": run_dir.name,
        "cards": card_summaries,
        "evaluation": _eval_dict(
            EvaluationResult(
                schema_valid=True,
                rule_score=run_rule_score,
                judge_score=run_judge_score,
                stability_score=0.0,
                passed=has_passed_card and run_rule_score >= 3.5 and run_judge_score >= 3.5,
                failure_reasons=sorted(set(all_reasons)),
            )
        ),
    }


def judge_card(
    *,
    context: VideoContext,
    knowledge_points: list[KnowledgePoint],
    card: RecoveryCard,
    provider: LLMProvider,
) -> JudgeAudit:
    audit, _ = judge_card_with_raw(
        context=context,
        knowledge_points=knowledge_points,
        card=card,
        provider=provider,
    )
    return audit


def judge_card_with_raw(
    *,
    context: VideoContext,
    knowledge_points: list[KnowledgePoint],
    card: RecoveryCard,
    provider: LLMProvider,
) -> tuple[JudgeAudit, str]:
    prompt = build_judge_prompt(context, knowledge_points, card)
    raw = _complete_judge(provider=provider, context=context, user_prompt=prompt)
    parsed = parse_with_optional_repair(
        raw=raw,
        parser=parse_judge_audit,
        provider=provider,
        expected_schema='{"scores":{...},"overall_score":4.6}',
        stage="audit",
    )
    audit = parsed.value
    reasons = list(audit.failure_reasons)
    for dimension, value in audit.scores.items():
        max_score = 2 if dimension.startswith(("knowledge_", "hook_", "answer_", "qa_", "boundary", "abstract", "timestamp", "consistency")) else 5
        threshold = 2 if max_score == 2 else 4
        if value < threshold:
            reasons.append(f"judge {dimension} below {threshold}: {value}")
    return JudgeAudit(
        scores=audit.scores,
        overall_score=audit.overall_score,
        failure_reasons=sorted(set(reasons)),
        audit_score=audit.audit_score,
        audit_score_max=audit.audit_score_max,
        audit_score_32=audit.audit_score_32,
        audit_score_30=audit.audit_score_30,
        audit_score_26=audit.audit_score_26,
        audit_grade=audit.audit_grade,
        treatment=audit.treatment,
        should_keep=audit.should_keep,
        main_issues=audit.main_issues,
        blocking_reasons=audit.blocking_reasons,
        revision_suggestions=audit.revision_suggestions,
    ), parsed.raw


def judge_candidate_group_with_raw(
    *,
    context: VideoContext,
    knowledge_point: KnowledgePoint,
    group: CardCandidateGroup,
    provider: LLMProvider,
) -> tuple[CandidateGroupAudit, str]:
    prompt = build_candidate_group_judge_prompt(context, knowledge_point, group)
    raw = _complete_judge(provider=provider, context=context, user_prompt=prompt)
    parsed = parse_with_optional_repair(
        raw=raw,
        parser=parse_candidate_group_audit,
        provider=provider,
        expected_schema=(
            '{"knowledge_point_id":"kp_001","candidate_ranking":["kp_001_c1",'
            '"kp_001_c2","kp_001_c3"],"selected_candidate_id":"kp_001_c1",'
            '"candidate_audits":[...]}'
        ),
        stage=f"candidate_audit:{group.knowledge_point_id}",
    )
    audit = parsed.value
    normalized: dict[str, JudgeAudit] = {}
    for candidate_id, candidate_audit in audit.candidate_audits.items():
        reasons = list(candidate_audit.failure_reasons)
        for dimension, value in candidate_audit.scores.items():
            if value < 2:
                reasons.append(f"judge {dimension} below 2: {value}")
        normalized[candidate_id] = JudgeAudit(
            scores=candidate_audit.scores,
            overall_score=candidate_audit.overall_score,
            failure_reasons=sorted(set(reasons)),
            audit_score=candidate_audit.audit_score,
            audit_score_max=candidate_audit.audit_score_max,
            audit_score_32=candidate_audit.audit_score_32,
            audit_score_30=candidate_audit.audit_score_30,
            audit_score_26=candidate_audit.audit_score_26,
            audit_grade=candidate_audit.audit_grade,
            treatment=candidate_audit.treatment,
            should_keep=candidate_audit.should_keep,
            main_issues=candidate_audit.main_issues,
            blocking_reasons=candidate_audit.blocking_reasons,
            revision_suggestions=candidate_audit.revision_suggestions,
        )
    return CandidateGroupAudit(
        knowledge_point_id=audit.knowledge_point_id,
        ranking=audit.ranking,
        selected_candidate_id=audit.selected_candidate_id,
        candidate_audits=normalized,
    ), parsed.raw


def _complete_judge(*, provider: LLMProvider, context: VideoContext, user_prompt: str) -> str:
    return _complete_model(
        provider=provider,
        context=context,
        system_prompt="你是严格输出 JSON 的质量评审模型。",
        user_prompt=user_prompt,
        temperature=0.0,
    )


def _complete_model(
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
    if context.has_frame_input:
        return provider.complete_with_frames(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            frames=context.frames,
            temperature=temperature,
        )
    if context.has_video_input:
        return provider.complete_with_video(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            video_data_url=context.video_data_url or "",
            video_fps=context.video_fps,
            temperature=temperature,
        )
    return provider.complete(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temperature,
    )


def _aggregate_case(run_summaries: list[dict]) -> dict:
    if not run_summaries:
        return _eval_dict(
            EvaluationResult(
                schema_valid=False,
                rule_score=0.0,
                judge_score=0.0,
                stability_score=0.0,
                passed=False,
                failure_reasons=["case has no runs"],
            )
        )

    evals = [item["evaluation"] for item in run_summaries]
    rule_scores = [float(item["rule_score"]) for item in evals]
    judge_scores = [float(item["judge_score"]) for item in evals]
    hooks = [
        card["hook_question"]
        for run in run_summaries
        for card in run.get("cards", [])
        if card.get("is_suitable_for_card")
    ]
    reasons = [reason for item in evals for reason in item.get("failure_reasons", [])]

    all_schema_valid = all(item["schema_valid"] for item in evals)
    every_run_has_suitable = all(
        any(card.get("is_suitable_for_card") for card in run.get("cards", []))
        for run in run_summaries
    )
    avg_rule = _avg(rule_scores)
    avg_judge = _avg(judge_scores)
    min_judge = min(judge_scores) if judge_scores else 0.0
    score_spread = max(judge_scores) - min_judge if judge_scores else 0.0
    unique_hooks = len(set(hooks))

    stability_score = 5.0
    if not every_run_has_suitable:
        stability_score -= 2.0
        reasons.append("not every run produced a suitable card")
    if avg_judge < 4.0:
        stability_score -= 1.0
        reasons.append(f"average judge score below 4.0: {avg_judge}")
    if min_judge < 3.5:
        stability_score -= 1.0
        reasons.append(f"minimum judge score below 3.5: {min_judge}")
    if len(run_summaries) >= 2 and unique_hooks < 2:
        stability_score -= 1.0
        reasons.append("suitable hooks are identical across runs")
    if score_spread > 1.0:
        stability_score -= 1.0
        reasons.append(f"judge score spread above 1.0: {round(score_spread, 2)}")

    passed = (
        all_schema_valid
        and every_run_has_suitable
        and avg_rule >= 3.5
        and avg_judge >= 4.0
        and min_judge >= 3.5
        and (len(run_summaries) < 2 or unique_hooks >= 2)
        and score_spread <= 1.0
    )
    return _eval_dict(
        EvaluationResult(
            schema_valid=all_schema_valid,
            rule_score=avg_rule,
            judge_score=avg_judge,
            stability_score=max(0.0, round(stability_score, 2)),
            passed=passed,
            failure_reasons=sorted(set(reasons)),
        )
    )


def _load_case(path: Path) -> ManifestCase:
    data = read_json(path)
    return ManifestCase.from_json(data, base_dir=path.parent, source_line=int(data.get("source_line", 0)))


def _visible_len(text: str) -> int:
    return len(re.sub(r"\s+", "", text.strip()))


def _hook_core_len(text: str) -> int:
    compact = re.sub(r"\s+", "", text.strip())
    compact = compact.rstrip("?？")
    return len(compact)


def _only_judgment(text: str) -> bool:
    cleaned = re.sub(r"[\s。.!！?？,，；;：:]", "", text)
    return cleaned in {"是", "不是", "会", "不会", "能", "不能", "对", "不对"}


def _question_count(text: str) -> int:
    marks = text.count("?") + text.count("？")
    return marks


def _allows_extended_hook_limit(card: RecoveryCard) -> bool:
    if card.question_style not in EXTENDED_HOOK_TASK_TYPES:
        return False
    hook = re.sub(r"\s+", "", card.hook_question)
    if re.search(r"\d", hook):
        return True
    return any(term in hook for term in CONCRETE_ANCHOR_TERMS)


def _looks_like_concept_exam_hook(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    return any(pattern.search(compact) for pattern in MISCONCEPTION_EXAM_PATTERNS)


def _looks_like_statement(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if stripped.endswith(("?", "？")):
        return False
    return any(
        token in stripped
        for token in [
            "会",
            "能",
            "是",
            "不是",
            "不只是",
            "主要",
            "可能",
            "影响",
            "导致",
            "帮助",
            "需要",
            "来自",
            "形成",
            "增加",
            "减少",
            "负责",
            "呈",
        ]
    )


def _avg(values: list[float]) -> float:
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def _eval_dict(result: EvaluationResult) -> dict:
    return {
        "schema_valid": result.schema_valid,
        "rule_score": result.rule_score if math.isfinite(result.rule_score) else 0.0,
        "judge_score": result.judge_score if math.isfinite(result.judge_score) else 0.0,
        "stability_score": result.stability_score if math.isfinite(result.stability_score) else 0.0,
        "passed": result.passed,
        "failure_reasons": result.failure_reasons,
    }
