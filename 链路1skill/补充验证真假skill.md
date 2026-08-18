---
name: chain1-claim-verification
description: 识别普通用户自然观看科普视频时会本能质疑的明确说法，依据可追溯证据生成中立核验；对有条件成立、过度绝对、范围或因果混淆的观点，输出适配310×180 H5的中立双栏解释。无独立证据时必须insufficient_evidence；不得为惊讶、好奇、没听懂或纯数字尺度触发。
metadata:
  version: "8"
  mode: governed
---

# 自然质疑、说法核验与观点澄清 Skill v8

## 1. 唯一职责

本 Skill 只处理：普通用户理解句意后，会在自然观看的一秒内本能产生“真的吗、这不对吧、这两个真是一回事吗”的明确认知冲突。

不寻找视频中所有可核验事实，不以专家审稿、辩论或找茬视角工作。

第一反应必须先分类：

- `accept`：正常接受 → 丢弃；
- `surprise_accept`：惊讶但接受 → 转 `abstract_to_intuitive` 或丢弃；
- `curiosity`：相信但想了解更多 → 不进入本 Skill；
- `confusion`：没听懂词义 → 转 `knowledge_gap`；
- `skepticism`：本能感觉不对 → 才能继续。

可核验、数字巨大、专业名词或画面很震撼，都不等于用户会自然质疑。

## 2. 输入与证据边界

读取 Harness 的文本证据输入：ASR 原文、时间戳、前后文和路由结果。此路由禁止读取 OCR 或关键帧。

当前 Harness 输入只证明“视频说了什么”，不自动提供独立事实来源。因此默认规则是：

- 不得伪造来源、研究、机构、发布日期或 URL；
- 不得把模型常识当作外部证据；
- 没有独立、可追溯的证据包时，`verification.status` 必须是 `insufficient_evidence`；
- 没有独立证据时只可进入 `list_only`/待复核，不得自动向用户下真假结论；
- 本 Skill 永远不输出生图 Prompt，最终由 H5 固定验证卡渲染。

未来只有当上游显式提供 `runtimeContext.verification_evidence` 时，才允许使用证据。每条证据必须含：

```yaml
source_url: string
source_title: string
source_type: primary | official | systematic_review | reputable_secondary
published_at: string | null
accessed_at: string
stance: supports | refutes | qualifies | background
summary: string
```

来源缺字段、无法定位、相互冲突或只与主题相关而不支持当前命题时，不能视为充分证据。

## 3. 强制五阶段

### 阶段1：提取原始说法

`source_text` 必须是视频真正说出的连续陈述，保持作者立场，不得改写成问题，不得提前加入核验结论。

### 阶段2：标准化命题

`normalized_claim` 只补全对象、指代、范围、时间和必要条件；不得反驳作者，不得偷换强度，不得把相关关系改成因果关系。

### 阶段3：确定唯一质疑焦点

`doubt_focus` 使用一个陈述性短语描述用户真正质疑的关系，不能写成生成后的问题。

允许类型：

- `truth_accuracy`
- `scope_accuracy`
- `causality_accuracy`
- `data_accuracy`
- `source_accuracy`
- `comparison_accuracy`
- `concept_equivalence`
- `internal_consistency`

若同时命中多个类型，只保留最直接决定结论的主类型，其他放入 `cognitive_friction_reason`。

### 阶段4：证据门与核验

只围绕 `normalized_claim + doubt_focus` 判断，不得偏移到另一个更容易回答的问题。

状态只能是：

- `accurate`
- `accurate_with_estimation`
- `conditional`
- `oversimplified`
- `misleading`
- `inaccurate`
- `disputed`
- `conflicted`
- `insufficient_evidence`

规则：

- `accurate` 到 `inaccurate`：必须有直接支持该判断的合格证据；
- `disputed/conflicted`：必须明确列出冲突双方及冲突点；
- 没有证据包、证据不可追溯或证据不足：只能 `insufficient_evidence`；
- 置信度必须与证据质量一致，不得凭感觉给出 `0.93` 等精确高分；
- `unknowns` 和 `conflicts` 必须显式保留，不能隐藏缺口。

### 阶段5：生成问题和中立回答

问题来自 `doubt_focus`，只问一个点，不预设作者错误，建议 10～22 个汉字，最多 28 个。

回答必须来自 `verification`：

- 先给克制判断；
- 再解释关键差异或成立条件；
- 最多两句话；
- 不攻击作者；
- `insufficient_evidence` 时只能说明证据不足和需要补什么，不得暗示真假。

然后决定展示变体：

- `viewpoint_clarification`：证据充分，且结论是 `conditional/oversimplified/misleading`，能用“常见范围 + 条件变化”准确表达；
- `verification_result`：明确准确或错误、证据冲突、存在争议、证据不足，或无法自然拆成两栏。

`viewpoint_clarification` 的固定 H5 合同：

- `helper_text` 固定为“换个角度看”；
- 卡片为 `310×180`，顶部一个问题，中部固定两栏；
- 左栏写常见/默认条件下的通常结果，右栏写条件改变后的可能结果或适用边界；
- 标题只能从受控组合中选择：`多数情况|需要注意`、`一般情况|条件变化`、`已有依据|适用边界`、`可以确认|仍需核验`、`常见规律|影响因素`、`已有发现|适用边界`、`实际含义|容易混淆`、`已有共识|尚存分歧`、`数据本身|口径差异`；
- 每栏只有一个信息焦点，建议 20～36 个汉字、最多 3 行；左右互补，不得写成支持方与反对方。
- `source_count` 必须等于当前 `verification.evidence` 中真实可追溯条目数，不得凭空填写；无证据时必须为 0。

## 4. 自然质疑与展示门槛

只有同时满足才可保留：

1. `viewer_reaction = skepticism`；
2. `instant_doubt_probability >= 0.70`；
3. 质疑点来自先验冲突、内部矛盾、因果跳跃、概念等同、范围过度或明显超证据语气；
4. 问题可在一张固定验证卡中简短表达；
5. 干预价值达到 55。

展示：

- 证据充分且干预价值 `>= 82` → `auto_prompt_high`；
- 证据充分且 `70～81` → `auto_prompt`；
- 证据充分且 `55～69` → `save_only`；
- `insufficient_evidence/disputed/conflicted` → `pending_review` 或 `save_only`；
- 不满足自然质疑门槛 → `discard`。

`should_trigger = false` 或 `display_action = discard` 时，Harness 不应生成候选。

## 5. 唯一输出 Schema

只输出 JSON，不要 Markdown，不要生图 Prompt，不要额外解释。

```json
{
  "video_id": "video_001",
  "claim_id": "claim_001",
  "should_trigger": true,
  "extraction": {
    "source_text": "全球股市市值减少被描述为这些钱彻底消失。",
    "source_start_ms": 126000,
    "source_end_ms": 133000,
    "source_segment_ids": ["seg_42", "seg_43"]
  },
  "normalization": {
    "normalized_claim": "全球股市市值减少等同于同等数量现金彻底消失。",
    "normalization_changes": ["补全这些钱的指代"]
  },
  "reaction_analysis": {
    "viewer_reaction": "skepticism",
    "reaction_reason": "视频把两个不同概念直接等同",
    "instant_doubt_probability": 0.78
  },
  "doubt_analysis": {
    "doubt_type": "concept_equivalence",
    "doubt_focus": "市值下降是否等于同等数量现金消失",
    "cognitive_friction_reason": ["市值和现金不是同一概念"]
  },
  "verification": {
    "status": "insufficient_evidence",
    "concise_judgment": "证据不足/待复核",
    "evidence_summary": "当前输入只能确认视频原话，未提供独立可追溯来源。",
    "key_conditions": [],
    "evidence": [],
    "unknowns": ["缺少针对标准化命题的独立来源"],
    "conflicts": [],
    "source_quality": "insufficient",
    "confidence": 0
  },
  "ranking": {
    "spontaneous_doubt_score": 78,
    "intervention_value_score": 65,
    "priority_level": "B",
    "display_action": "pending_review"
  },
  "generated_content": {
    "card_variant": "verification_result",
    "question": "市值下降真等于现金消失吗？",
    "helper_text": "换个角度看",
    "answer_label": "证据不足/待复核",
    "short_answer": "当前证据只能确认视频的说法，还不足以独立判断真假。",
    "card_answer": "缺少可追溯来源，暂不能下确定结论。",
    "left_column": null,
    "right_column": null,
    "source_count": 0,
    "source_action": "查看依据"
  },
  "trigger": {
    "trigger_at_ms": 133500
  }
}
```

证据充分且适合双栏时，`generated_content` 必须为：

```json
{
  "card_variant": "viewpoint_clarification",
  "question": "冰水就是不健康的吗？",
  "helper_text": "换个角度看",
  "answer_label": "需分情况",
  "short_answer": "多数健康人适量饮用通常无明显问题，但个体和饮用方式会改变体感。",
  "card_answer": "需要同时看常见情况和条件变化。",
  "left_column": {
    "title": "一般情况",
    "content": "多数健康人适量饮用，通常不会造成明显问题。"
  },
  "right_column": {
    "title": "条件变化",
    "content": "胃肠敏感或大量快速饮用时，可能出现短暂不适。"
  },
  "source_count": 3,
  "source_action": "查看依据"
}
```

不满足自然质疑门槛时仍输出完整最小结构：

```json
{
  "video_id": "video_001",
  "claim_id": "claim_001",
  "should_trigger": false,
  "reaction_analysis": {
    "viewer_reaction": "surprise_accept",
    "instant_doubt_probability": 0.35
  },
  "ranking": {
    "intervention_value_score": 0,
    "display_action": "discard"
  },
  "generated_content": {
    "question": "",
    "answer_label": "",
    "short_answer": "",
    "card_answer": ""
  },
  "trigger": {
    "trigger_at_ms": 0
  }
}
```

## 6. 必须通过的回归

1. 巨大数字只引发震撼 → `surprise_accept`，丢弃或转数字尺度。
2. 专业名词只是没听懂 → `confusion`，转知识断层。
3. 前后将市值和现金混同 → `skepticism + concept_equivalence`。
4. 相关性直接写成因果 → `causality_accuracy`。
5. 没有外部证据 → 强制 `insufficient_evidence`，不得高置信判真伪。
6. 来源相互冲突 → `conflicted`，保留双方证据和冲突点。
7. 问题字段不得污染 `source_text/normalized_claim/doubt_focus`。
8. 输出不得包含 `image_prompt`、`visualization` 或任何生图指令。
9. 有条件成立且证据充分 → `viewpoint_clarification`，左右栏互补。
10. 无证据时即使模型生成了双栏，Harness 也必须删除双栏并回退 `verification_result`。

## 7. 最终执行顺序

```text
提取原始陈述
→ 标准化但不纠正
→ 分类自然观看第一反应
→ 非skepticism直接分流
→ 提取唯一doubt_focus
→ 检查独立证据包
→ 按证据门生成verification
→ 选择verification_result或viewpoint_clarification
→ 生成中立问答或310×180双栏内容
→ 输出JSON；不生图
```
