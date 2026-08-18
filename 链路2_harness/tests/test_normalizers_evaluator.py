from __future__ import annotations

import json
import hashlib
import unittest
from pathlib import Path

from huazhongdian_harness.evaluator import (
    hard_audit_failures,
    hard_rule_failures,
    rule_check_card,
    rule_check_knowledge_points,
)
from huazhongdian_harness.normalizers import (
    parse_card_candidate_groups,
    parse_judge_audit,
    parse_judge_output,
    parse_knowledge_points,
    parse_recovery_cards,
)
from huazhongdian_harness.models import ManifestCase, VideoContext
from huazhongdian_harness.prompts import build_selection_prompt, load_prompt_asset


class NormalizerEvaluatorTests(unittest.TestCase):
    def test_prompt_assets_match_approved_skill_versions(self) -> None:
        expected = {
            "knowledge_point_selection.md": "5fff87ed8e5a5f5b9dfdc2c32e7136fa25070640f4fa3914dd71e84901a260b7",
            "card_generation.md": "f11dce806302fb1b9958a11848d2219b4131331c0055409706ceafa2cb52af19",
            "quality_audit.md": "61005ce94c80939ff0c9d2185b5d465e4e1539868286bce186df4d9dc0c209fc",
        }
        for name, digest in expected.items():
            with self.subTest(name=name):
                content = load_prompt_asset(name).encode("utf-8")
                self.assertEqual(hashlib.sha256(content).hexdigest(), digest)

    def test_selection_prompt_requires_dynamic_full_scan(self) -> None:
        context = VideoContext(
            case=ManifestCase(
                case_id="case_001",
                video_id="video_001",
                video_path=Path("video.mp4"),
                title="测试视频",
                duration_seconds=600,
                language="zh-CN",
            ),
            source_text="00:00-10:00 一段包含多个知识点的科普视频。",
        )

        prompt = build_selection_prompt(context)

        self.assertIn("不设固定知识点数量", prompt)
        self.assertIn("不能默认输出 5 个左右", prompt)
        self.assertIn("评分 >= 9", prompt)
        self.assertIn("不要因为数量多而截断合格知识点", prompt)
        self.assertIn("不得明显重叠", prompt)

    def test_parse_knowledge_points_does_not_truncate(self) -> None:
        payload = {
            "knowledge_points": [
                {
                    "knowledge_point_id": f"kp_{index:03d}",
                    "statement": f"第{index}个生活习惯会通过具体机制影响身体反馈和健康风险。",
                    "start_time": index * 20,
                    "end_time": index * 20 + 15,
                    "selection_scores": {"fact_complete": 1},
                    "priority": "S",
                    "task_type": "原因解释型",
                    "timestamp_note": "从正式解释该机制开始，前面只是话题铺垫。",
                }
                for index in range(1, 11)
            ]
        }

        points = parse_knowledge_points(json.dumps(payload, ensure_ascii=False))

        self.assertEqual(len(points), 10)
        self.assertEqual(points[-1].knowledge_point_id, "kp_010")

    def test_rule_check_knowledge_points_rejects_significant_overlap(self) -> None:
        kps = parse_knowledge_points(
            """
            {"knowledge_points":[
              {"knowledge_point_id":"kp_001","statement":"当前A股市场最核心的稀缺要素是投资者信心而非交易制度调整。","start_time":34,"end_time":50,"selection_scores":{"fact_complete":1},"priority":"S","task_type":"误区纠正型","timestamp_note":"从正式点出信心开始讲解。"},
              {"knowledge_point_id":"kp_002","statement":"散户频繁做短线交易的核心原因是参与者对长期增值缺乏信任。","start_time":38,"end_time":60,"selection_scores":{"fact_complete":1},"priority":"S","task_type":"原因解释型","timestamp_note":"从解释散户短线交易原因开始。"}
            ]}
            """
        )

        result = rule_check_knowledge_points(kps)

        self.assertTrue(any("overlaps" in reason for reason in result.failure_reasons))

    def test_rule_check_knowledge_points_allows_adjacent_or_tiny_boundary_overlap(self) -> None:
        adjacent = parse_knowledge_points(
            """
            {"knowledge_points":[
              {"knowledge_point_id":"kp_001","statement":"当前A股市场最核心的稀缺要素是投资者信心而非交易制度调整。","start_time":34,"end_time":50,"selection_scores":{"fact_complete":1},"priority":"S","task_type":"误区纠正型","timestamp_note":"从正式点出信心开始讲解。"},
              {"knowledge_point_id":"kp_002","statement":"散户频繁做短线交易的核心原因是参与者对长期增值缺乏信任。","start_time":50,"end_time":70,"selection_scores":{"fact_complete":1},"priority":"S","task_type":"原因解释型","timestamp_note":"从解释散户短线交易原因开始。"}
            ]}
            """
        )
        tiny_overlap = parse_knowledge_points(
            """
            {"knowledge_points":[
              {"knowledge_point_id":"kp_001","statement":"当前A股市场最核心的稀缺要素是投资者信心而非交易制度调整。","start_time":34,"end_time":50,"selection_scores":{"fact_complete":1},"priority":"S","task_type":"误区纠正型","timestamp_note":"从正式点出信心开始讲解。"},
              {"knowledge_point_id":"kp_002","statement":"散户频繁做短线交易的核心原因是参与者对长期增值缺乏信任。","start_time":48,"end_time":70,"selection_scores":{"fact_complete":1},"priority":"S","task_type":"原因解释型","timestamp_note":"从解释散户短线交易原因开始。"}
            ]}
            """
        )

        self.assertFalse(any("overlaps" in reason for reason in rule_check_knowledge_points(adjacent).failure_reasons))
        self.assertFalse(any("overlaps" in reason for reason in rule_check_knowledge_points(tiny_overlap).failure_reasons))

    def test_parse_json_fences_and_cards(self) -> None:
        raw = """```json
        {"cards":[{"video_id":"v1","card_id":"c1","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"为什么甜饮会升尿酸？","highlight_answer":"会，果糖代谢可能推高尿酸，咋一步步变高的？看视频。","source_start_time":72,"source_end_time":95,"video_entry_text":"想知道果糖怎么影响尿酸？","video_cta_text":"看原视频 18 秒解释","theme":"health","difficulty_level":"easy","risk_level":"medium","question_style":"原因解释型","curiosity_score":0.91,"is_suitable_for_card":true}]}
        ```"""
        cards = parse_recovery_cards(raw, default_video_id="v1")
        self.assertEqual(cards[0].hook_question, "为什么甜饮会升尿酸？")
        self.assertEqual(cards[0].question_style, "原因解释型")

    def test_parse_candidate_groups_requires_three_distinct_hooks(self) -> None:
        cards = [
            {
                "video_id": "v1",
                "card_id": f"kp1_c{index}",
                "candidate_index": index,
                "self_score": 9 - index,
                "card_type": "recovery",
                "knowledge_point_id": "kp1",
                "hook_question": hook,
                "highlight_answer": "会，果糖代谢可能推高尿酸，视频会展开完整变化过程。",
                "source_start_time": 72,
                "source_end_time": 95,
                "video_entry_text": "看果糖代谢的完整过程",
                "video_cta_text": "回看对应讲解",
                "theme": "health",
                "difficulty_level": "easy",
                "risk_level": "medium",
                "question_style": "原因解释型",
                "curiosity_score": 0.9,
                "is_suitable_for_card": True,
            }
            for index, hook in enumerate(
                ["为什么甜饮也升尿酸？", "喝甜饮怎么牵连尿酸？", "甜饮升尿酸关键在哪？"],
                start=1,
            )
        ]
        groups = parse_card_candidate_groups(
            json.dumps(
                {"candidate_groups": [{"knowledge_point_id": "kp1", "candidates": cards}]},
                ensure_ascii=False,
            ),
            default_video_id="v1",
        )
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0].candidates), 3)

    def test_rule_check_good_card_passes(self) -> None:
        kps = parse_knowledge_points(
            '{"knowledge_points":[{"knowledge_point_id":"kp1","statement":"甜饮里的果糖可能促进尿酸生成并让尿酸升高。","start_time":72,"end_time":95,"selection_scores":{"clarity":1},"priority":"S","task_type":"原因解释型","timestamp_note":"从正式解释果糖代谢开始，前面只是引入甜饮话题。"}]}'
        )
        card = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c1","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"为什么甜饮也升尿酸？","highlight_answer":"会，果糖代谢可能推高尿酸，咋一步步变高的？看视频。","source_start_time":72,"source_end_time":95,"video_entry_text":"想知道果糖怎么影响尿酸？","video_cta_text":"看原视频 18 秒解释","theme":"health","difficulty_level":"easy","risk_level":"medium","question_style":"原因解释型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        result = rule_check_card(card, kps)
        self.assertGreaterEqual(result.score, 4.0)
        self.assertEqual(result.failure_reasons, [])
        kp_result = rule_check_knowledge_points(kps)
        self.assertGreaterEqual(kp_result.score, 4.0)

    def test_rule_check_bad_card_records_failures(self) -> None:
        kps = parse_knowledge_points(
            '{"knowledge_points":[{"knowledge_point_id":"kp1","statement":"甜饮里的果糖可能促进尿酸生成并让尿酸升高。","start_time":72,"end_time":95,"selection_scores":{"clarity":1},"priority":"S"}]}'
        )
        card = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c1","card_type":"recovery","knowledge_point_id":"kp_missing","hook_question":"高情商影响力核心步骤是什么","highlight_answer":"不是。","source_start_time":72,"source_end_time":180,"video_entry_text":"看看原视频","video_cta_text":"看原视频","theme":"health","difficulty_level":"easy","risk_level":"medium","curiosity_score":0.2,"is_suitable_for_card":false}]}',
            default_video_id="v1",
        )[0]
        result = rule_check_card(card, kps)
        self.assertLess(result.score, 3.5)
        self.assertTrue(result.failure_reasons)
        self.assertTrue(hard_rule_failures(result))

    def test_misconception_hook_must_sound_like_inner_voice(self) -> None:
        kps = parse_knowledge_points(
            '{"knowledge_points":[{"knowledge_point_id":"kp1","statement":"痛风不只发生在老年人身上，年轻人也可能因习惯问题发作。","start_time":10,"end_time":35,"selection_scores":{"clarity":1},"priority":"S","task_type":"误区纠正型","timestamp_note":"从年轻人痛风案例开始正式解释。"}]}'
        )
        bad_card = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c1","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"痛风是老年专属病吗？","highlight_answer":"不是，年轻人也可能被习惯影响，为啥偏年轻？视频里有数据。","source_start_time":10,"source_end_time":35,"video_entry_text":"看看年轻人为什么也会痛风","video_cta_text":"看原视频","theme":"health","difficulty_level":"easy","risk_level":"medium","question_style":"误区纠正型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        result = rule_check_card(bad_card, kps)
        self.assertIn("misconception hook is not phrased as user inner voice", hard_rule_failures(result))

        good_card = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c2","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"年轻人就不会得痛风吗？","highlight_answer":"不是，年轻人也可能被习惯影响，为啥偏年轻？视频里有数据。","source_start_time":10,"source_end_time":35,"video_entry_text":"看看年轻人为什么也会痛风","video_cta_text":"看原视频","theme":"health","difficulty_level":"easy","risk_level":"medium","question_style":"误区纠正型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        self.assertNotIn(
            "misconception hook is not phrased as user inner voice",
            rule_check_card(good_card, kps).failure_reasons,
        )

    def test_anchor_contrast_hook_can_extend_to_18_chars(self) -> None:
        kps = parse_knowledge_points(
            '{"knowledge_points":[{"knowledge_point_id":"kp1","statement":"直径约5米的小陨石，高速撞击时能释放接近核爆量级的能量。","start_time":20,"end_time":45,"selection_scores":{"clarity":1},"priority":"S","task_type":"尺度反差型","timestamp_note":"从介绍5米陨石撞击能量开始正式讲解。"}]}'
        )
        default_too_long = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c1","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"这个小东西威力真能那么大吗？","highlight_answer":"能，高速撞击会释放巨大能量，差多少？看视频对比。","source_start_time":20,"source_end_time":45,"video_entry_text":"看看小陨石威力有多大","video_cta_text":"看原视频","theme":"science","difficulty_level":"easy","risk_level":"medium","question_style":"原因解释型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        self.assertTrue(any("hook core length" in reason for reason in rule_check_card(default_too_long, kps).failure_reasons))

        anchored = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c2","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"5米小陨石真像原子弹吗？","highlight_answer":"可能接近，关键在高速撞击能量，差多少？看视频对比。","source_start_time":20,"source_end_time":45,"video_entry_text":"看看小陨石威力有多大","video_cta_text":"看原视频","theme":"science","difficulty_level":"easy","risk_level":"medium","question_style":"尺度反差型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        self.assertFalse(any("hook core length" in reason for reason in rule_check_card(anchored, kps).failure_reasons))

    def test_answer_rewatch_suffix_must_connect_naturally(self) -> None:
        kps = parse_knowledge_points(
            '{"knowledge_points":[{"knowledge_point_id":"kp1","statement":"甜饮里的果糖可能促进尿酸生成并让尿酸升高。","start_time":72,"end_time":95,"selection_scores":{"clarity":1},"priority":"S","task_type":"原因解释型","timestamp_note":"从正式解释果糖代谢开始，前面只是引入甜饮话题。"}]}'
        )
        bad_card = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c1","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"为什么甜饮也升尿酸？","highlight_answer":"会，果糖代谢可能推高尿酸，代谢路径视频里有详解。","source_start_time":72,"source_end_time":95,"video_entry_text":"想知道果糖怎么影响尿酸？","video_cta_text":"看原视频 18 秒解释","theme":"health","difficulty_level":"easy","risk_level":"medium","question_style":"原因解释型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        self.assertIn("answer suffix is not naturally connected", hard_rule_failures(rule_check_card(bad_card, kps)))

        good_card = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c2","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"为什么甜饮也升尿酸？","highlight_answer":"会，果糖代谢可能推高尿酸，咋一步步变高的？看视频。","source_start_time":72,"source_end_time":95,"video_entry_text":"想知道果糖怎么影响尿酸？","video_cta_text":"看原视频 18 秒解释","theme":"health","difficulty_level":"easy","risk_level":"medium","question_style":"原因解释型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        self.assertNotIn("answer suffix is not naturally connected", rule_check_card(good_card, kps).failure_reasons)

    def test_complete_answer_without_mechanical_suffix_is_allowed(self) -> None:
        kps = parse_knowledge_points(
            '{"knowledge_points":[{"knowledge_point_id":"kp1","statement":"甜饮里的果糖可能促进尿酸生成并让尿酸升高。","start_time":72,"end_time":95,"selection_scores":{"clarity":1},"priority":"S","task_type":"原因解释型","timestamp_note":"从正式解释果糖代谢开始。"}]}'
        )
        card = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c1","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"为什么甜饮也升尿酸？","highlight_answer":"会，关键是果糖代谢可能促进尿酸生成并让尿酸水平升高。","source_start_time":72,"source_end_time":95,"video_entry_text":"看果糖进入肝脏后的完整代谢过程","video_cta_text":"回看对应片段","theme":"health","difficulty_level":"easy","risk_level":"medium","question_style":"原因解释型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        self.assertFalse(
            any("replay" in reason for reason in rule_check_card(card, kps).failure_reasons)
        )

        fake_hook = parse_recovery_cards(
            '{"cards":[{"video_id":"v1","card_id":"c2","card_type":"recovery","knowledge_point_id":"kp1","hook_question":"为什么甜饮也升尿酸？","highlight_answer":"会，视频里有详解。","source_start_time":72,"source_end_time":95,"video_entry_text":"看看原视频","video_cta_text":"回看对应片段","theme":"health","difficulty_level":"easy","risk_level":"medium","question_style":"原因解释型","curiosity_score":0.91,"is_suitable_for_card":true}]}',
            default_video_id="v1",
        )[0]
        self.assertIn(
            "answer relies on generic replay wording",
            hard_rule_failures(rule_check_card(fake_hook, kps)),
        )

    def test_rule_check_bad_knowledge_point_records_failures(self) -> None:
        kps = parse_knowledge_points(
            '{"knowledge_points":[{"knowledge_point_id":"kp1","statement":"果糖？","start_time":72,"end_time":180,"selection_scores":{"clarity":1},"priority":"S"}]}'
        )
        result = rule_check_knowledge_points(kps)
        self.assertLess(result.score, 4.0)
        self.assertTrue(any("task_type" in reason for reason in result.failure_reasons))

    def test_parse_judge_output(self) -> None:
        scores, overall, reasons = parse_judge_output(
            '{"scores":{"curiosity":4,"plain_language":5},"overall_score":4.5,"failure_reasons":[]}'
        )
        self.assertEqual(scores["plain_language"], 5.0)
        self.assertEqual(overall, 4.5)
        self.assertEqual(reasons, [])

    def test_parse_judge_audit_output(self) -> None:
        audit = parse_judge_audit(
            '{"audit_score_30":28,"audit_grade":"S","treatment":"可直接使用","should_keep":true,"scores":{"hook_alignment":2,"answer_focus_accuracy":2},"main_issues":[],"blocking_reasons":[],"revision_suggestions":{"hook_question":null},"failure_reasons":[]}'
        )
        self.assertEqual(audit.audit_score_30, 28)
        self.assertEqual(audit.audit_score, 28)
        self.assertEqual(audit.audit_score_max, 30)
        self.assertEqual(audit.audit_grade, "S")
        self.assertEqual(audit.overall_score, 4.67)
        self.assertTrue(audit.should_keep)

        audit_32 = parse_judge_audit(
            '{"audit_score_32":30,"audit_grade":"S","treatment":"可直接使用","should_keep":true,"scores":{"hook_alignment":2},"main_issues":[],"blocking_reasons":[],"revision_suggestions":{},"failure_reasons":[]}'
        )
        self.assertEqual(audit_32.audit_score_32, 30)
        self.assertEqual(audit_32.audit_score_max, 32)
        self.assertEqual(audit_32.overall_score, 4.69)

    def test_hard_audit_failures_require_full_key_dimensions(self) -> None:
        audit = parse_judge_audit(
            '{"audit_score_32":30,"audit_grade":"S","treatment":"可直接使用","should_keep":true,"scores":{"hook_readability":2,"hook_question_quality":1,"hook_no_answer_leak":2,"answer_directness":2,"answer_natural_hook":2,"qa_pairing":2,"promise_fulfillment":2,"timestamp_quality":2,"consistency":2},"main_issues":[],"blocking_reasons":[],"revision_suggestions":{"hook_question":null},"failure_reasons":[]}'
        )
        self.assertEqual(hard_audit_failures(audit), ["judge hook_question_quality below 2: 1.0"])

        promise_failure = parse_judge_audit(
            '{"audit_score_32":28,"audit_grade":"B","treatment":"需要重写","should_keep":false,"scores":{"hook_readability":2,"hook_question_quality":2,"hook_no_answer_leak":2,"answer_directness":2,"answer_natural_hook":2,"qa_pairing":2,"promise_fulfillment":1,"timestamp_quality":2,"consistency":2},"main_issues":[],"blocking_reasons":[],"revision_suggestions":{},"failure_reasons":["题目承诺未兑现"]}'
        )
        self.assertIn(
            "judge promise_fulfillment below 2: 1.0",
            hard_audit_failures(promise_failure),
        )


if __name__ == "__main__":
    unittest.main()
