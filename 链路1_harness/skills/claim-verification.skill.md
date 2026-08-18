# 用户自然质疑触发与中立问答生成 Skill v6

## 1. Skill 名称

**用户自然质疑触发与中立问答生成器｜字段分层版**

---

## 2. 本版解决的问题

v5 已经能够区分“惊讶、好奇、没听懂和自然质疑”，但仍可能出现一个工程问题：

> 模型没有先提取视频原始说法，而是直接输出了生成后的用户问题。

例如错误输出：

```text
市值蒸发，真的代表钱彻底消失了吗？
```

这是一句**生成后的问题**，不能作为“提取内容”。

本版强制拆分以下阶段：

```text
阶段1：提取视频原始说法
阶段2：标准化原始说法
阶段3：识别用户自然质疑焦点
阶段4：核验说法
阶段5：生成用户问题和中立回答
```

任何阶段不得越级。

---

# 第一部分：核心目标与最高优先级规则

## 3. 核心目标

本 Skill 用于识别：

> 普通用户在自然刷科普短视频时，不带纠错任务、不主动审稿、不暂停查资料，听到某句话后，会在极短时间内本能产生“这是真的吗？”“这不对吧？”“这两个真是一回事吗？”的内容。

本 Skill 不寻找视频中所有可核验事实，只捕捉自然观看状态下真实发生的认知摩擦。

---

## 4. 五类用户第一反应

每条候选必须先分类，只允许从以下五种中选择一种：

```yaml
viewer_reaction:
  accept
  surprise_accept
  curiosity
  confusion
  skepticism
```

### 4.1 accept：正常接受

用户反应：

```text
知道了。
原来是这样。
```

处理：

```yaml
display_action: discard
```

### 4.2 surprise_accept：惊讶但接受

用户反应：

```text
这么多！
居然要这么久！
```

处理：

```yaml
route:
  - video_knowledge_point
  - number_visualization
display_action: discard
```

**惊讶不等于质疑。**

### 4.3 curiosity：相信，但想了解更多

用户反应：

```text
具体包括什么？
为什么会这样？
```

处理：

```yaml
route: video_knowledge_point
```

### 4.4 confusion：没有听懂

用户反应：

```text
这个词是什么意思？
这一步怎么来的？
```

处理：

```yaml
route: concept_gap
```

### 4.5 skepticism：本能感觉不对

用户反应：

```text
真的吗？
不对吧？
这两个不是一回事吧？
怎么就得出这个结论了？
```

只有这一类进入后续验证链路。

---

## 5. 最高优先级限制

### 5.1 可核验不等于用户会质疑

“全球实体现金约55万亿元”可以核验，但普通用户通常没有参照，不会在观看时本能质疑。

### 5.2 数字巨大不等于用户会质疑

“每天花1万元，需要2.4亿年”通常引发的是震撼，而不是核算冲动。

### 5.3 专业名词不等于用户会质疑

“市值蒸发”“广义货币”若用户只是没听懂，应进入知识断层链路。

### 5.4 只有明显认知摩擦才进入验证

认知摩擦主要来自：

- 与用户已有经验或常识冲突；
- 视频内部前后矛盾；
- 因果或逻辑跳跃；
- 两个不同概念被直接等同；
- 强确定语气明显超过证据支持；
- 与用户健康、金钱、安全等行为直接相关。

---

# 第二部分：强制五阶段处理链路

## 6. 阶段1：提取视频原始说法

### 6.1 目标

从 ASR/OCR 中截取视频真正说出的陈述句。

### 6.2 输出字段

```yaml
source_text: string
source_start_ms: integer
source_end_ms: integer
source_segment_ids:
  - string
```

### 6.3 source_text 硬规则

`source_text` 必须：

- 来自原视频文案；
- 保留原作者核心表述；
- 是陈述句或判断句；
- 不得改写成用户问题；
- 不得提前加入核验结论；
- 不得只输出主题名词。

### 6.4 禁止

禁止把以下形式写入 `source_text`：

```text
……吗？
……是否？
……真的等于……吗？
……怎么会……？
```

除非原视频本身说的就是这个问题，并且该问题后面又给出了明确结论。否则视为字段污染，必须重新提取。

### 6.5 例子

原文：

```text
全球股市在接下来几个月蒸发了约10万亿美元，也就是这些钱在这场海啸里彻底消失。
```

正确：

```yaml
source_text: 全球股市在接下来几个月蒸发了约10万亿美元，这些钱在这场海啸里彻底消失。
```

错误：

```yaml
source_text: 市值蒸发，真的代表钱彻底消失了吗？
```

---

## 7. 阶段2：标准化原始说法

### 7.1 目标

补全指代、对象、条件和上下文，使说法成为完整可核验命题。

### 7.2 输出字段

```yaml
normalized_claim: string
normalization_changes:
  - string
```

### 7.3 normalized_claim 硬规则

`normalized_claim` 必须：

- 保持原作者立场；
- 保持陈述句形式；
- 只补全指代、对象、条件和上下文；
- 可以去掉口头语和重复内容；
- 不得提前反驳、纠正或核验；
- 不得变成用户问题。

### 7.4 正确示例

```yaml
source_text: 这些钱在这场海啸里彻底消失。
normalized_claim: 全球股市市值减少约10万亿美元，等同于这些钱彻底消失。
```

### 7.5 错误示例

```yaml
normalized_claim: 市值下降并不等于现金消失。
```

错误原因：这已经是核验答案，不是原说法标准化。

---

## 8. 阶段3：识别自然质疑焦点

### 8.1 目标

判断用户为什么会感觉“不对”，而不是马上生成问题。

### 8.2 输出字段

```yaml
viewer_reaction: skepticism

doubt_type: string

doubt_focus: string

cognitive_friction_reason:
  - string

reaction_reason: string
```

### 8.3 doubt_focus 定义

`doubt_focus` 必须用陈述性短语描述用户真正质疑的关系。

正确：

```text
市值下降是否等于同等数量现金彻底消失
```

错误：

```text
市值蒸发，真的等于钱消失了吗？
```

后者属于 `question` 字段。

### 8.4 质疑类型

```yaml
doubt_type:
  truth_accuracy
  scope_accuracy
  causality_accuracy
  data_accuracy
  source_accuracy
  comparison_accuracy
  concept_equivalence
  internal_consistency
```

---

## 9. 新增类型：concept_equivalence

### 9.1 定义

视频将两个相关但不同的概念，直接表达成同一件事，使用户自然产生：

> 这两个真的等同吗？

### 9.2 典型结构

```text
概念A发生变化
=
概念B真实发生变化
```

### 9.3 典型例子

```text
市值蒸发 = 同等现金消失
体重下降 = 脂肪减少
出汗更多 = 减脂更多
风险增加 = 一定发生
相关性 = 因果关系
资产估值 = 可直接支配现金
```

### 9.4 问题模板

```text
{概念A}真的等于{概念B}吗？
```

### 9.5 回答模板

```text
不完全等同。{概念A的准确含义}，并不代表{概念B的误解结果}。
```

---

## 10. 新增类型：internal_consistency

### 10.1 定义

视频前后内容之间存在用户无需外部知识就能察觉的不一致。

### 10.2 例子

前文：

```text
资产不是银行卡里的现金。
```

后文：

```text
市值蒸发后，这些钱彻底消失了。
```

### 10.3 处理

```yaml
doubt_type: internal_consistency
doubt_focus: 前文区分资产与现金，后文却将市值下降描述成现金消失
```

若核心问题同时是概念混用，主类型选择 `concept_equivalence`，`internal_consistency` 写入辅助原因。

---

## 11. 阶段4：核验说法

### 11.1 目标

围绕 `normalized_claim` 和 `doubt_focus` 核验，不得偏离质疑焦点。

例如：

```yaml
normalized_claim: 全球股市市值减少约10万亿美元，等同于这些钱彻底消失。
doubt_focus: 市值下降是否等于同等数量现金彻底消失
```

核验重点应是：

- 市值变化与现金变化的区别；
- “蒸发”的金融含义；
- “彻底消失”是否准确；

而不是把主要精力放在“10万亿美元数字是否精确”。

### 11.2 核验状态

```yaml
verification_status:
  accurate
  accurate_with_estimation
  conditional
  oversimplified
  insufficient_evidence
  disputed
  misleading
  inaccurate
```

### 11.3 核验输出

```yaml
verification_result:
  status: misleading
  concise_judgment: 不完全等同
  evidence_summary: 市值下降主要反映市场估值下降，不代表等量现金被销毁
  key_conditions:
    - 市值是价格乘以流通数量形成的估值
    - 市值变化不要求发生等额现金交易
  source_quality: high
  confidence: 0.93
```

---

## 12. 阶段5：生成用户问题和中立回答

只有完成前四阶段后，才允许生成：

```yaml
question: string
answer_label: string
short_answer: string
card_answer: string
```

生成内容必须围绕 `doubt_focus`，不得重新选择另一个质疑点。

---

# 第三部分：输入结构

## 13. 输入

```yaml
video_id: string
title: string
description: optional

asr_segments:
  - segment_id: string
    start_ms: integer
    end_ms: integer
    text: string

ocr_segments:
  - start_ms: integer
    end_ms: integer
    text: string

visual_context:
  - start_ms: integer
    end_ms: integer
    description: string
    contains_scale_visualization: boolean
    contains_chart_or_source: boolean
    contains_simulation: boolean

comments_summary: optional
  doubt_comment_count: integer
  doubt_comment_ratio: number
  typical_doubt_phrases:
    - string

behavior_signals: optional
  replay_peak_near_claim: boolean
  pause_peak_near_claim: boolean
  comment_open_peak_near_claim: boolean

verification_result: optional

runtime_context: optional
  previous_prompt_end_ms: optional
  ignored_prompt_count: optional
  same_type_prompt_count: optional
  user_assistance_preference: optional
```

---

# 第四部分：最终输出结构

## 14. 标准输出

```json
{
  "video_id": "video_001",
  "claim_id": "claim_001",

  "extraction": {
    "source_text": "全球股市在接下来几个月蒸发了约10万亿美元，这些钱在这场海啸里彻底消失。",
    "source_start_ms": 126000,
    "source_end_ms": 133000,
    "source_segment_ids": ["seg_42", "seg_43"]
  },

  "normalization": {
    "normalized_claim": "全球股市市值减少约10万亿美元，等同于这些钱彻底消失。",
    "normalization_changes": [
      "将‘全球股市蒸发’补全为‘全球股市市值减少’",
      "补全‘这些钱’指代的对象"
    ]
  },

  "reaction_analysis": {
    "viewer_reaction": "skepticism",
    "reaction_reason": "视频前文区分了资产估值与现金，后文却将市值下降描述为钱彻底消失。",
    "instant_doubt_probability": 0.78,
    "audience_has_prior_belief": "medium"
  },

  "doubt_analysis": {
    "doubt_type": "concept_equivalence",
    "doubt_focus": "市值下降是否等于同等数量现金彻底消失",
    "cognitive_friction_reason": [
      "市值与现金不是同一概念",
      "视频前后表述存在潜在逻辑冲突",
      "‘彻底消失’使用了强确定语气"
    ]
  },

  "verification": {
    "status": "misleading",
    "concise_judgment": "不完全等同",
    "evidence_summary": "市值蒸发主要是资产估值下降，并不代表等量现金被直接销毁。",
    "source_quality": "high",
    "confidence": 0.93
  },

  "ranking": {
    "spontaneous_doubt_score": 82,
    "intervention_value_score": 84,
    "priority_level": "S",
    "display_action": "auto_prompt_high"
  },

  "generated_content": {
    "question": "市值蒸发，真的等于钱消失了吗？",
    "answer_label": "更准确的理解",
    "short_answer": "不完全等同。市值蒸发主要指资产估值下降，并不代表同等数量的现金被直接销毁。",
    "card_answer": "市值下降不等于同等现金被直接销毁。"
  },

  "trigger": {
    "trigger_at_ms": 133500,
    "route": "claim_verification"
  }
}
```

---

# 第五部分：自然观看筛选机制

## 15. 自然观看前提

模型必须模拟：

> 普通用户正在连续刷科普短视频，没有被要求找错误，不会主动审稿、计算或搜索，只是顺着视频观看。

禁止站在以下视角：

- 专家审稿人；
- 事实核查员；
- 辩论对手；
- 评论区找茬用户；
- 已经知道正确答案的人。

---

## 16. 1秒自然质疑测试

必须判断：

> 这句话讲完后，普通用户是否会在1秒内、本能地产生“这不对吧？”的想法？

输出：

```yaml
instant_doubt_probability: 0.0-1.0
```

门槛：

```yaml
>= 0.70:
  继续核验和评级

0.45-0.69:
  observation_only

< 0.45:
  discard
```

若 `viewer_reaction` 不是 `skepticism`，即使理论上可核验，也不得主动触发。

---

## 17. 认知摩擦评分

```text
spontaneous_doubt_score =
30% × 先验认知冲突
+ 25% × 视频内部矛盾
+ 20% × 因果或逻辑跳跃
+ 15% × 自我相关与行为影响
+ 10% × 过度确定语气
- 视觉说服抑制
- 叙事流畅抑制
- 缺少先验参照抑制
- 低自我相关抑制
- 惊讶但接受抑制
```

### 17.1 正向因素

```yaml
prior_belief_conflict: 0-30
internal_contradiction: 0-25
causal_or_logical_gap: 0-20
self_relevance: 0-15
overcertainty: 0-10
```

### 17.2 抑制因素

```yaml
visual_persuasion_penalty: 0-15
narrative_fluency_penalty: 0-15
lack_of_prior_reference_penalty: 0-15
low_personal_relevance_penalty: 0-10
surprise_accept_penalty: 0-20
```

若 `surprise_accept = true`，至少扣15分。

---

## 18. 行为意图测试

预测用户是否可能：

```yaml
behavior_intent:
  open_comments_probability: 0.0-1.0
  replay_probability: 0.0-1.0
  seek_explanation_probability: 0.0-1.0
```

若三项最高值仍低于 `0.50`，不主动提示。

---

# 第六部分：问题生成规则

## 19. 问题必须来自 doubt_focus

生成顺序：

```text
normalized_claim
↓
doubt_focus
↓
question
```

不得从 `source_text` 中随意挑另一个更吸睛的点。

---

## 20. 问题长度

```yaml
recommended_length: 10-22个汉字
maximum_length: 28个汉字
sentence_count: 1
```

---

## 21. 问题模板

### 21.1 概念等同

```text
{概念A}真的等于{概念B}吗？
```

### 21.2 前后矛盾

```text
前面说{A}，这里怎么又成了{B}？
```

卡片可压缩为：

```text
{A}和{B}真是一回事吗？
```

### 21.3 因果跳跃

```text
{前提}怎么就会导致{结果}？
```

### 21.4 范围过度

```text
{对象}一定都{结论}吗？
```

### 21.5 来源质疑

```text
真的有{研究/机构}支持{结论}吗？
```

---

## 22. 问题禁止项

禁止：

- 直接判定作者错误；
- 生成两个以上质疑点；
- 完整复述长原文；
- 把主题硬改成真假问题；
- 使用“这个可信吗”这类空泛问题；
- 把生成的问题写回 `source_text` 或 `normalized_claim`；
- 添加视频没有表达的结论。

---

# 第七部分：中立回答生成规则

## 23. 回答结构

```text
简短判断
+
关键解释
+
必要边界
```

### 23.1 short_answer

```yaml
recommended_length: 35-65个汉字
maximum_length: 85个汉字
maximum_sentences: 2
```

### 23.2 card_answer

```yaml
recommended_length: 25-45个汉字
maximum_length: 55个汉字
maximum_sentences: 2
```

---

## 24. 回答必须依据 verification_result

不得根据问题的质疑语气，自动生成反对答案。

例如问题：

```text
市值蒸发，真的等于钱消失了吗？
```

正确回答必须来自核验：

```text
不完全等同。市值蒸发主要指资产估值下降，并不代表同等数量现金被直接销毁。
```

若核验结果显示原说法基本准确，则回答也应中立说明其成立条件，而不是为了满足问题形式强行反驳。

---

## 25. 中立判断词

```yaml
accurate:
  - 基本准确
  - 大体成立

accurate_with_estimation:
  - 基本算得通
  - 数量级大致合理

conditional:
  - 在特定条件下成立
  - 不能一概而论

oversimplified:
  - 方向大致正确，但省略了关键条件

insufficient_evidence:
  - 现有证据还不足以支持确定结论

disputed:
  - 目前没有完全一致的结论

misleading:
  - 这个表达容易引起误解
  - 不完全等同

inaccurate:
  - 这个说法并不准确
```

禁止：

```text
这是假的
博主说错了
千万别信
百分之百正确
完全可信
```

---

# 第八部分：评级与展示

## 26. 干预价值

```text
intervention_value_score =
30% × 核心结论重要性
+ 25% × 用户误解后的影响
+ 20% × 回答带来的信息增益
+ 15% × 核验确定性
+ 10% × 卡片表达适配度
- 打扰成本
```

---

## 27. 展示等级

```yaml
S:
  score: ">=82"
  display_action: auto_prompt_high

A:
  score: "70-81"
  display_action: auto_prompt

B:
  score: "55-69"
  display_action: save_only

C:
  score: "<55"
  display_action: discard
```

即使为 S/A 级，也必须先满足：

- `viewer_reaction = skepticism`
- `instant_doubt_probability >= 0.70`
- 核验可靠；
- 问答可简短表达；
- 运行时没有冲突。

---

# 第九部分：字段级强校验

## 28. source_text 校验

```text
[ ] 是否直接来自原视频？
[ ] 是否保留原作者说法？
[ ] 是否为陈述句？
[ ] 是否没有问号？
[ ] 是否没有加入模型核验结论？
[ ] 是否不是主题名词？
```

若不通过，重新提取。

---

## 29. normalized_claim 校验

```text
[ ] 是否保持原作者立场？
[ ] 是否只补全对象、指代和条件？
[ ] 是否仍是陈述句？
[ ] 是否没有提前反驳？
[ ] 是否没有问号？
```

若不通过，重新标准化。

---

## 30. doubt_focus 校验

```text
[ ] 是否指出唯一、具体的质疑关系？
[ ] 是否为陈述性短语？
[ ] 是否没有写成用户问题？
[ ] 是否与自然认知摩擦一致？
[ ] 是否不是模型审稿后才发现的专业问题？
```

---

## 31. question 校验

```text
[ ] 是否只存在于 generated_content.question？
[ ] 是否围绕 doubt_focus？
[ ] 是否像普通用户自然会问？
[ ] 是否不超过28个汉字？
[ ] 是否只问一个问题？
[ ] 是否不预设作者错误？
```

---

## 32. answer 校验

```text
[ ] 是否基于核验结果？
[ ] 是否先给克制判断？
[ ] 是否解释最关键差异？
[ ] 是否保留必要边界？
[ ] 是否不超过两句话？
[ ] 是否没有攻击作者？
[ ] 确定程度是否与证据一致？
```

---

# 第十部分：正反案例

## 33. 正确案例：市值蒸发

```yaml
extraction:
  source_text: 全球股市在接下来几个月蒸发了约10万亿美元，这些钱在这场海啸里彻底消失。

normalization:
  normalized_claim: 全球股市市值减少约10万亿美元，等同于这些钱彻底消失。

reaction_analysis:
  viewer_reaction: skepticism
  instant_doubt_probability: 0.78

doubt_analysis:
  doubt_type: concept_equivalence
  doubt_focus: 市值下降是否等于同等数量现金彻底消失
  cognitive_friction_reason:
    - 市值和现金不是同一概念
    - 视频前文已说明资产不是银行卡现金
    - “彻底消失”语气过度确定

verification:
  status: misleading

generated_content:
  question: 市值蒸发，真的等于钱消失了吗？
  short_answer: 不完全等同。市值蒸发主要指资产估值下降，并不代表同等数量的现金被直接销毁。
```

---

## 34. 错误案例：把问题当作提取结果

```yaml
source_text: 市值蒸发，真的代表钱彻底消失了吗？
```

错误原因：

```text
这是模型生成的用户问题，不是视频原始说法。
```

正确处理：

```yaml
source_text: 全球股市蒸发了约10万亿美元，这些钱在这场海啸里彻底消失。
question: 市值蒸发，真的等于钱消失了吗？
```

---

## 35. 错误案例：标准化阶段提前纠正

```yaml
normalized_claim: 市值下降并不等于现金消失。
```

错误原因：

```text
提前写入了核验结论。
```

正确：

```yaml
normalized_claim: 全球股市市值下降被描述为同等数量的钱彻底消失。
```

---

## 36. 正确分流案例：2.4亿年

原文：

```text
每天花1万元，需要2.4亿年才能花完900万亿元。
```

输出：

```yaml
viewer_reaction: surprise_accept
instant_doubt_probability: 0.35
display_action: discard
route:
  - video_knowledge_point
  - number_visualization
```

不得因为理论上可复算，就强行进入验证链路。

---

# 第十一部分：最终决策流程

## 37. 完整流程

```text
读取视频文案、时间戳和视觉信息
↓
阶段1：提取视频真正说出的原始陈述
↓
source_text 是否来自原文且为陈述句？
├─ 否 → 重新提取
└─ 是
   ↓
阶段2：补全指代，形成 normalized_claim
↓
是否保持原作者立场且未提前纠正？
├─ 否 → 重新标准化
└─ 是
   ↓
模拟普通用户自然观看
↓
第一反应是什么？
├─ accept → discard
├─ surprise_accept → 数字直观化/视频知识点
├─ curiosity → 视频知识点
├─ confusion → 知识断层
└─ skepticism → 继续
   ↓
阶段3：提取唯一 doubt_focus
↓
是否存在先验冲突、内部矛盾、逻辑跳跃、
概念等同或过度确定？
├─ 否 → discard
└─ 是
   ↓
1秒自然质疑概率是否≥0.70？
├─ 否 → observation_only/discard
└─ 是
   ↓
阶段4：围绕 doubt_focus 完成核验
↓
核验是否可靠？
├─ 否 → pending_verification
└─ 是
   ↓
阶段5：根据 doubt_focus + verification_result
生成 question 和 answer
↓
计算干预价值
↓
S/A → 主动提示
B → 只存列表
C → 忽略
```

---

# 第十二部分：最终原则

## 38. 阶段原则

> 先提取视频说了什么，再判断用户为什么觉得不对，最后才替用户生成问题。

## 39. 字段原则

> 原始说法、标准化说法、质疑焦点、用户问题和核验回答必须存放在不同字段中，不得混用。

## 40. 自然观看原则

> 用户是在刷视频，不是在进行事实核查。惊讶、好奇和没听懂都不等于质疑。

## 41. 克制原则

> 只有用户会本能感觉不对，并且简短解释明显有价值时，才主动出现。

## 42. 最终定义

> **验证视频说法链路不是寻找所有潜在错误，而是捕捉普通用户自然观看时真实发生的认知冲突，并围绕同一个质疑焦点生成可靠、中立、简短的问答。**
