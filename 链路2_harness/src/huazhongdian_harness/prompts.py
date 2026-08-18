from __future__ import annotations

import json
from importlib import resources

from .models import CardCandidateGroup, KnowledgePoint, RecoveryCard, VideoContext, to_jsonable


STANDALONE_ANSWER_OVERRIDE = """
当前产品规则（优先级高于上方 skill 中所有“追回、回看、引流、答案钩子”历史规则）：
- 知识点列表收起时展示问题，展开后只展示这个知识点的独立解答。
- `highlight_answer` 必须直接、完整、清楚地回答问题，优先包含“明确结论 + 核心原因/机制 + 必要条件或边界”。
- 禁止引导用户看视频或继续观看，禁止出现“看视频、回看、原视频、视频里/视频中有详解、对应讲解、对应片段”等表达。
- 不要为了制造悬念故意少答，不要在答案末尾追加新问题；用户不看视频也应理解答案。
- 答案通常写 1-3 句、30-90 个中文字符；简单知识点可以更短，但必须信息闭合。
- `video_entry_text` 固定填写“知识点来源”，`video_cta_text` 固定填写“对应时间段”；它们不参与最终 H5 展示。
""".strip()


def load_prompt_asset(name: str) -> str:
    prompt_file = resources.files(__package__).joinpath("prompts", name)
    return prompt_file.read_text(encoding="utf-8")


def build_selection_prompt(context: VideoContext) -> str:
    skill = load_prompt_asset("knowledge_point_selection.md")
    source_block = _source_block(context)
    return f"""
{skill}

{STANDALONE_ANSWER_OVERRIDE}

你现在是「划重点」后端 harness 的知识点选择器。

请基于下面的视频内容，选择适合生成追回卡的问题知识点。必须只输出 JSON，不要 markdown，不要解释。

硬要求：
- 不设固定知识点数量，不能默认输出 5 个左右，不能只挑“最重要的几个”做摘要式精选。
- 必须按视频真实讲解段落逐段扫描，输出所有互不重复、边界清楚、符合新版 skill 且评分 >= 9 的知识点。
- 时间段必须按独立讲解段落切分；不同知识点之间不得明显重叠，除 0-2 秒边界误差外，后一条 `start_time` 不能早于前一条 `end_time`。
- 如果同一段内容可拆出多个候选知识点，必须合并成一个边界清楚的知识点，或拆成不重叠的连续时间段。
- 13-14 分知识点必须入选；11-12 分优先入选；9-10 分也要入选；8 分及以下不要进入本轮 `knowledge_points`。
- 长视频可以输出 10 个以上知识点，短视频可以只有 1-3 个；不要为了凑数量补弱知识点，也不要因为数量多而截断合格知识点。
- 知识点必须是“可出题事实句”，不能是标题、问题、标签或章节名。
- `start_time` 必须是开始讲解这个知识点的开端，不是关键词出现处。
- 每个知识点必须标注 `task_type`，从新版 skill 的统一 10 类任务类型中选择。
- 每个知识点必须写 `timestamp_note`，说明为什么这个时间点是正式讲解开端。
- `question_direction` 是知识点列表收起时展示的问题；`answer_core` 是展开后展示的独立解答。
- `answer_core` 必须包含清楚结论和核心解释，禁止回看引导；兼容字段 `answer_hook` 固定输出空字符串。

视频元信息：
- video_id: {context.case.video_id}
- title: {context.case.title}
- duration_seconds: {context.case.duration_seconds}
- language: {context.case.language}

{source_block}

输出 JSON 结构：
{{
  "knowledge_points": [
    {{
      "knowledge_point_id": "kp_001",
      "statement": "完整事实句，不能只是章节标题或名词",
      "start_time": 72,
      "end_time": 95,
      "selection_scores": {{
        "fact_complete": 1,
        "description_valid": 1,
        "answer_core": 1,
        "clear_boundary": 1,
        "task_type_clear": 1,
        "explanatory_value": 1,
        "user_relevance": 1,
        "contrast_or_misconception": 1,
        "question_feasible": 1,
        "answer_feasible": 1,
        "question_tension": 1,
        "answer_hook": 1,
        "batch_distinctness": 1,
        "timestamp_precise": 1
      }},
      "priority": "S",
      "task_type": "原因解释型",
      "tension_triad": {{
        "common_sense": "甜饮只会让人发胖",
        "counterintuitive": "甜饮也可能推高尿酸",
        "explanation": "果糖代谢会促进尿酸生成"
      }},
      "question_direction": "为什么甜饮也会升尿酸？",
      "answer_core": "果糖代谢可能促进尿酸生成",
      "answer_hook": "",
      "timestamp_note": "从“果糖进入肝脏代谢后……”开始正式解释机制，前面只是引入甜饮话题。"
    }}
  ]
}}
""".strip()


def build_card_generation_prompt(context: VideoContext, knowledge_points: list[KnowledgePoint]) -> str:
    skill = load_prompt_asset("card_generation.md")
    kp_json = json.dumps(to_jsonable(knowledge_points), ensure_ascii=False, indent=2)
    return f"""
{skill}

{STANDALONE_ANSWER_OVERRIDE}

你现在是「划重点」后端 harness 的追回卡生成器。

产品方向：
- 不是 A/B 答题。
- 不是判断对错。
- 正面只生成一个有好奇心的 Hook 问题。
- 列表展开后直接给出可独立理解的清楚解答，不做回看引导。

请基于下面已经选出的知识点生成 recovery card 候选组。必须只输出 JSON，不要 markdown，不要解释。

硬要求：
- 题目必须对齐知识点，不能为了吸引人乱扩展或偷换。
- 先判断知识点适合的统一任务类型：原因解释型、误区纠正型、影响结果型、过程变化型、信号识别型、方法决策型、作用说明型、关系结构型、尺度反差型、对比差异型。
- 能源产业 / 资源约束类要抓“矛盾 + 结果/解决路径”，不要只写单一资源限制。
- 抽象概念 / 社会经济类要写机制和结果，不能写定义题或口号题。
- 题目不能提前泄露答案原因；题干里不要直接放答案核心原因。
- 租房、找房、交易、合同类答案必须降绝对化，并补充必要核验边界。
- 默认 Hook 核心字数 9-14 字（不含问号）；尺度反差型、对比差异型、误区纠正型且题面含具体数字或具体对象锚点时，可放宽到 18 字。
- 误区纠正型必须写成用户心里话句式，如“年轻人就不会得痛风吗？”，不要写成“X 是 Y 专属吗？”这类概念判断题。
- 知识点有隐含反差时，优先用“也、就、才、反而、还、连”等反差助词增强题面。
- Hook 必须适配卡片两行显示：第二行固定为最后 8 个核心字 + 问号，第一行为剩余前缀。
- 不要在 `hook_question` 里手动换行；前端会按最后 8 个核心字自动换行。
- 答案通常 30-90 字，采用“明确结论 + 核心原因/机制 + 必要条件或边界”，只答当前知识点，不混入第二个知识点。
- 答案必须信息闭合，禁止留下“怎么发生、差多少、有哪些情况”等悬而未答的问题。
- 禁止任何看视频、回看、继续观看或跳转片段的引导文案。
- 禁止答案不完整却依赖“视频里有详解”，也禁止“代谢路径视频里有详解”这类名词短语悬空拼接。
- 每个知识点必须生成 3 个真正不同的候选，分别使用不同题目入口或表达角度；不能只换一两个字。
- 三个候选全部输出给审核 skill v7 排序，不得在生成阶段自行淘汰。
- 同一批不同知识点也要避免重复同一种题目句式和关键词。

视频元信息：
- video_id: {context.case.video_id}
- title: {context.case.title}
- duration_seconds: {context.case.duration_seconds}

Harness 冻结的 ASR/OCR 证据（只能据此改写问题和答案，不得补入未出现的事实）：
{context.source_text or "无可用文本证据"}

知识点：
{kp_json}

输出 JSON 结构：
{{
  "candidate_groups": [
    {{
      "knowledge_point_id": "kp_001",
      "candidates": [
        {{
          "video_id": "{context.case.video_id}",
          "card_id": "kp_001_c1",
          "candidate_index": 1,
          "self_score": 8,
          "card_type": "recovery",
          "knowledge_point_id": "kp_001",
          "hook_question": "为什么甜饮也升尿酸？",
          "highlight_answer": "会。果糖在肝脏代谢时可能促进尿酸生成，因此长期大量喝含糖饮料可能使尿酸升高。",
          "source_start_time": 72,
          "source_end_time": 95,
          "video_entry_text": "知识点来源",
          "video_cta_text": "对应时间段",
          "theme": "health",
          "difficulty_level": "easy",
          "risk_level": "medium",
          "question_style": "原因解释型",
          "curiosity_score": 0.91,
          "is_suitable_for_card": true
        }},
        {{
          "video_id": "{context.case.video_id}",
          "card_id": "kp_001_c2",
          "candidate_index": 2,
          "self_score": 7,
          "card_type": "recovery",
          "knowledge_point_id": "kp_001",
          "hook_question": "喝甜饮怎么会牵连尿酸？",
          "highlight_answer": "关键在果糖代谢。果糖代谢会消耗能量物质并促进尿酸生成，摄入过多时更容易推高尿酸。",
          "source_start_time": 72,
          "source_end_time": 95,
          "video_entry_text": "知识点来源",
          "video_cta_text": "对应时间段",
          "theme": "health",
          "difficulty_level": "easy",
          "risk_level": "medium",
          "question_style": "原因解释型",
          "curiosity_score": 0.88,
          "is_suitable_for_card": true
        }},
        {{
          "video_id": "{context.case.video_id}",
          "card_id": "kp_001_c3",
          "candidate_index": 3,
          "self_score": 7,
          "card_type": "recovery",
          "knowledge_point_id": "kp_001",
          "hook_question": "甜饮升尿酸，问题出在哪？",
          "highlight_answer": "问题主要出在果糖代谢：摄入过多果糖会促进尿酸生成，所以甜饮不只影响体重，也可能影响尿酸。",
          "source_start_time": 72,
          "source_end_time": 95,
          "video_entry_text": "知识点来源",
          "video_cta_text": "对应时间段",
          "theme": "health",
          "difficulty_level": "easy",
          "risk_level": "medium",
          "question_style": "原因解释型",
          "curiosity_score": 0.86,
          "is_suitable_for_card": true
        }}
      ]
    }}
  ]
}}
""".strip()


def build_candidate_group_regeneration_prompt(
    context: VideoContext,
    knowledge_point: KnowledgePoint | None,
    failed_group: CardCandidateGroup,
    failure_reasons: list[str],
    *,
    attempt_number: int,
    max_attempts: int,
) -> str:
    skill = load_prompt_asset("card_generation.md")
    knowledge_point_json = json.dumps(to_jsonable(knowledge_point), ensure_ascii=False, indent=2)
    failed_group_json = json.dumps(to_jsonable(failed_group), ensure_ascii=False, indent=2)
    failure_json = json.dumps(failure_reasons, ensure_ascii=False, indent=2)
    return f"""
{skill}

{STANDALONE_ANSWER_OVERRIDE}

你现在是「划重点」后端 harness 的三候选重写器。

这组候选没有通过规则检查或审核 skill。请只基于同一个知识点重新生成 3 个不同候选。

重写目标：
- 这是第 {attempt_number}/{max_attempts} 次审核尝试前的重写。
- 必须针对失败原因修正，不要扩大知识点，不要换成其他知识点。
- 必须保留原候选组的三个 `card_id`、`knowledge_point_id`、`source_start_time`、`source_end_time`，除非失败原因明确指出时间戳错误。
- Hook 必须是自然口语问句，不泄露答案核心，不手动换行。
- 默认 Hook 核心字数 9-14 字；符合尺度反差/对比差异/误区纠正且有具体对象锚点时最多 18 字。
- 答案通常 30-90 字，直接完整回答问题，不得保留回看钩子或新的悬念问句。
- 三个候选必须使用不同题目入口，不能只是同义改写。
- 必须只输出 JSON，不要 markdown，不要解释。

视频元信息：
- video_id: {context.case.video_id}
- title: {context.case.title}
- duration_seconds: {context.case.duration_seconds}

对应知识点：
{knowledge_point_json}

未通过候选组：
{failed_group_json}

失败原因：
{failure_json}

输出 JSON 结构：
{{
  "candidate_groups": [
    {{
      "knowledge_point_id": "{failed_group.knowledge_point_id}",
      "candidates": [
        {{
          "video_id": "{context.case.video_id}",
          "card_id": "{failed_group.candidates[0].card_id}",
          "candidate_index": 1,
          "self_score": 8,
          "card_type": "recovery",
          "knowledge_point_id": "{failed_group.knowledge_point_id}",
          "hook_question": "为什么甜饮也升尿酸？",
          "highlight_answer": "会。果糖在肝脏代谢时可能促进尿酸生成，因此长期大量喝含糖饮料可能使尿酸升高。",
          "source_start_time": {failed_group.candidates[0].source_start_time},
          "source_end_time": {failed_group.candidates[0].source_end_time},
          "video_entry_text": "知识点来源",
          "video_cta_text": "对应时间段",
          "theme": "{failed_group.candidates[0].theme}",
          "difficulty_level": "{failed_group.candidates[0].difficulty_level}",
          "risk_level": "{failed_group.candidates[0].risk_level}",
          "question_style": "{failed_group.candidates[0].question_style}",
          "curiosity_score": 0.91,
          "is_suitable_for_card": true
        }},
        {{
          "video_id": "{context.case.video_id}",
          "card_id": "{failed_group.candidates[1].card_id}",
          "candidate_index": 2,
          "self_score": 7,
          "card_type": "recovery",
          "knowledge_point_id": "{failed_group.knowledge_point_id}",
          "hook_question": "喝甜饮怎么会牵连尿酸？",
          "highlight_answer": "关键在果糖代谢。果糖代谢会消耗能量物质并促进尿酸生成，摄入过多时更容易推高尿酸。",
          "source_start_time": {failed_group.candidates[1].source_start_time},
          "source_end_time": {failed_group.candidates[1].source_end_time},
          "video_entry_text": "知识点来源",
          "video_cta_text": "对应时间段",
          "theme": "{failed_group.candidates[1].theme}",
          "difficulty_level": "{failed_group.candidates[1].difficulty_level}",
          "risk_level": "{failed_group.candidates[1].risk_level}",
          "question_style": "{failed_group.candidates[1].question_style}",
          "curiosity_score": 0.88,
          "is_suitable_for_card": true
        }},
        {{
          "video_id": "{context.case.video_id}",
          "card_id": "{failed_group.candidates[2].card_id}",
          "candidate_index": 3,
          "self_score": 7,
          "card_type": "recovery",
          "knowledge_point_id": "{failed_group.knowledge_point_id}",
          "hook_question": "甜饮升尿酸，问题出在哪？",
          "highlight_answer": "问题主要出在果糖代谢：摄入过多果糖会促进尿酸生成，所以甜饮不只影响体重，也可能影响尿酸。",
          "source_start_time": {failed_group.candidates[2].source_start_time},
          "source_end_time": {failed_group.candidates[2].source_end_time},
          "video_entry_text": "知识点来源",
          "video_cta_text": "对应时间段",
          "theme": "{failed_group.candidates[2].theme}",
          "difficulty_level": "{failed_group.candidates[2].difficulty_level}",
          "risk_level": "{failed_group.candidates[2].risk_level}",
          "question_style": "{failed_group.candidates[2].question_style}",
          "curiosity_score": 0.86,
          "is_suitable_for_card": true
        }}
      ]
    }}
  ]
}}
""".strip()


def _source_block(context: VideoContext) -> str:
    if context.has_frame_input:
        text = f"\n\n带绝对时间戳的口播/OCR证据：\n{context.source_text}" if context.source_text else ""
        return (
            "视频内容：\n"
            f"本请求已附带 {len(context.frames)} 张定向抽取的局部关键帧。"
            "每张图像前都有对应时间戳。请把这些画面当作视频时间线证据，"
            "严格基于文本、画面与时间戳选择知识点；不要编造未出现的内容。"
            + text
        )
    if context.has_video_input:
        return (
            "视频内容：\n"
            "本请求已附带 video_url 多模态输入。请直接观看/理解该视频，"
            "并严格基于视频中明确出现的内容选择知识点。"
        )
    if context.has_file_input:
        return (
            "视频内容：\n"
            "本请求已通过 Files API 附带原始视频文件。请直接观看/理解该视频，"
            "并严格基于视频中明确出现的内容选择知识点。"
        )
    return f"视频文本/摘要：\n{context.source_text}"


def build_judge_prompt(
    context: VideoContext,
    knowledge_points: list[KnowledgePoint],
    card: RecoveryCard,
) -> str:
    skill = load_prompt_asset("quality_audit.md")
    kp_json = json.dumps(to_jsonable(knowledge_points), ensure_ascii=False, indent=2)
    card_json = json.dumps(to_jsonable(card), ensure_ascii=False, indent=2)
    return f"""
{skill}

{STANDALONE_ANSWER_OVERRIDE}

你现在是「划重点」后端出题 harness 的质量审核模型。

请按上面的审核 skill，对这张 recovery card 做结构化审核。必须只输出 JSON，不要 markdown，不要解释。

审核口径：
- 按 v7 张力诊断 + 答案钩子口径做 32 分制审核，并给出 S/A/B/C/D。
- S/A 可视为可入候选；B 需要重写后再入候选；C/D 不应直接入候选。
- 规则分值要尽量贴近审核 skill，不要为了通过而放宽。
- 即使输入只有一张 card，也要按 v7 的单条深审执行。
- 答案必须独立、完整地兑现题目承诺；出现任何回看或继续观看引导时，必须判 B 或更低并要求重写。
- 评分字段 `answer_natural_hook` 在当前产品中按“独立解答完整度”评分，不再奖励回看钩子。

视频元信息：
- video_id: {context.case.video_id}
- title: {context.case.title}

已选知识点：
{kp_json}

待评估卡片：
{card_json}

必须只输出 JSON，结构如下：
{{
  "audit_score_32": 30,
  "audit_grade": "S",
  "treatment": "可直接使用",
  "should_keep": true,
  "scores": {{
    "knowledge_point_fact_sentence": 2,
    "knowledge_point_answer_core": 2,
    "knowledge_point_explanatory_value": 2,
    "hook_readability": 2,
    "hook_question_quality": 2,
    "hook_no_answer_leak": 2,
    "hook_alignment": 2,
    "answer_directness": 2,
    "answer_focus_accuracy": 2,
    "answer_natural_hook": 2,
    "qa_pairing": 2,
    "promise_fulfillment": 2,
    "boundary_safety": 2,
    "abstract_concept_quality": 2,
    "timestamp_quality": 2,
    "consistency": 2
  }},
  "overall_score": 4.6,
  "main_issues": [],
  "blocking_reasons": [],
  "revision_suggestions": {{
    "knowledge_point": null,
    "hook_question": null,
    "highlight_answer": null
  }},
  "failure_reasons": []
}}
""".strip()


def build_candidate_group_judge_prompt(
    context: VideoContext,
    knowledge_point: KnowledgePoint,
    group: CardCandidateGroup,
) -> str:
    skill = load_prompt_asset("quality_audit.md")
    kp_json = json.dumps(to_jsonable(knowledge_point), ensure_ascii=False, indent=2)
    group_json = json.dumps(to_jsonable(group), ensure_ascii=False, indent=2)
    audit_rows = json.dumps(
        [
            {
                "candidate_id": card.card_id,
                "audit_score_32": 30,
                "audit_grade": "S",
                "treatment": "可直接使用",
                "should_keep": True,
                "scores": {
                    "knowledge_point_fact_sentence": 2,
                    "knowledge_point_answer_core": 2,
                    "knowledge_point_explanatory_value": 2,
                    "hook_readability": 2,
                    "hook_question_quality": 2,
                    "hook_no_answer_leak": 2,
                    "hook_alignment": 2,
                    "answer_directness": 2,
                    "answer_focus_accuracy": 2,
                    "answer_natural_hook": 2,
                    "qa_pairing": 2,
                    "promise_fulfillment": 2,
                    "boundary_safety": 2,
                    "abstract_concept_quality": 2,
                    "timestamp_quality": 2,
                    "consistency": 2,
                },
                "overall_score": 4.7,
                "main_issues": [],
                "blocking_reasons": [],
                "revision_suggestions": {
                    "knowledge_point": None,
                    "hook_question": None,
                    "highlight_answer": None,
                },
                "failure_reasons": [],
            }
            for card in group.candidates
        ],
        ensure_ascii=False,
        indent=2,
    )
    return f"""
{skill}

{STANDALONE_ANSWER_OVERRIDE}

你现在是「划重点」后端 harness 的 v7 三候选排序与质量审核模型。

请先对同一知识点的 3 个候选排序，再对每个候选执行 32 分深审。必须只输出 JSON，不要 markdown，不要解释。

产品审核补充：
- 题目必须有张力但不能泄露解释侧，也不能靠低质标题党词汇。
- 答案必须先正面回答并兑现题目承诺。
- 答案必须独立、完整、清楚；出现“看视频、回看、原视频、视频里/视频中有详解”等引导时，必须判 B 或更低。
- 评分字段 `answer_natural_hook` 在当前产品中按“独立解答完整度”评分，不再奖励回看钩子。
- 如果承诺的数据、过程、对比、案例在知识点和视频片段中没有依据，必须判 D。
- 3 个候选如果只是同义改写，应在一致性和 failure_reasons 中体现。
- S/A 可用；B 需要整组重写；C/D 不可用。

视频元信息：
- video_id: {context.case.video_id}
- title: {context.case.title}

知识点：
{kp_json}

三候选：
{group_json}

必须只输出 JSON，结构如下：
{{
  "knowledge_point_id": "{group.knowledge_point_id}",
  "candidate_ranking": [
    "{group.candidates[0].card_id}",
    "{group.candidates[1].card_id}",
    "{group.candidates[2].card_id}"
  ],
  "selected_candidate_id": "{group.candidates[0].card_id}",
  "candidate_audits": {audit_rows}
}}
""".strip()


def build_candidate_groups_judge_prompt(
    context: VideoContext,
    knowledge_points: list[KnowledgePoint],
    groups: list[CardCandidateGroup],
) -> str:
    """Build one v7 audit request for a small batch of question-answer groups."""
    skill = load_prompt_asset("quality_audit.md")
    points_by_id = {point.knowledge_point_id: point for point in knowledge_points}
    inputs = [
        {
            "knowledge_point": to_jsonable(points_by_id[group.knowledge_point_id]),
            "candidate_group": to_jsonable(group),
        }
        for group in groups
    ]
    input_json = json.dumps(inputs, ensure_ascii=False, indent=2)
    output_rows = [
        {
            "knowledge_point_id": group.knowledge_point_id,
            "candidate_ranking": [candidate.card_id for candidate in group.candidates],
            "selected_candidate_id": group.candidates[0].card_id,
            "candidate_audits": [
                {
                    "candidate_id": candidate.card_id,
                    "audit_score_32": 30,
                    "audit_grade": "S",
                    "treatment": "可直接使用",
                    "should_keep": True,
                    "scores": {
                        "knowledge_point_fact_sentence": 2,
                        "knowledge_point_answer_core": 2,
                        "knowledge_point_explanatory_value": 2,
                        "hook_readability": 2,
                        "hook_question_quality": 2,
                        "hook_no_answer_leak": 2,
                        "hook_alignment": 2,
                        "answer_directness": 2,
                        "answer_focus_accuracy": 2,
                        "answer_natural_hook": 2,
                        "qa_pairing": 2,
                        "promise_fulfillment": 2,
                        "boundary_safety": 2,
                        "abstract_concept_quality": 2,
                        "timestamp_quality": 2,
                        "consistency": 2,
                    },
                    "overall_score": 4.7,
                    "main_issues": [],
                    "blocking_reasons": [],
                    "revision_suggestions": {
                        "knowledge_point": None,
                        "hook_question": None,
                        "highlight_answer": None,
                    },
                    "failure_reasons": [],
                }
                for candidate in group.candidates
            ],
        }
        for group in groups
    ]
    output_json = json.dumps({"group_audits": output_rows}, ensure_ascii=False, indent=2)
    return f"""
{skill}

{STANDALONE_ANSWER_OVERRIDE}

你现在是「划重点」后端 harness 的 v7 问题答案质量审核模型。

请对每个知识点的 3 个问题答案候选分别排序和 32 分深审。必须只输出 JSON，不要 markdown，不要解释。

审核规则：
- 每个知识点必须独立审核，不得串题。
- 题目必须对齐知识点、不泄露解释侧，答案必须先正面回答并兑现题目承诺。
- 答案出现任何看视频、回看、继续观看或跳转片段引导，必须判 B 或更低。
- 答案必须给出清楚、可独立理解的结论和解释；故意留下悬念问句也必须降级。
- 评分字段 `answer_natural_hook` 在当前产品中按“独立解答完整度”评分，不再奖励回看钩子。
- S/A 可用；B 需要重写；C/D 不可用。
- `selected_candidate_id` 必须是 `candidate_ranking` 第一项。

视频元信息：
- video_id: {context.case.video_id}
- title: {context.case.title}

Harness 冻结的 ASR/OCR 证据（候选中的结论、原因、数字和条件都必须可由此支持）：
{context.source_text or "无可用文本证据"}

候选组批量审核输入：
{input_json}

必须只输出与输入顺序一致的 JSON，结构如下：
{output_json}
""".strip()
