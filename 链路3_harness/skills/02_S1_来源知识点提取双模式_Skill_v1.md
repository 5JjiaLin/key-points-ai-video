# S1：来源知识点提取双模式 Skill v1

## 1. Skill 定位

本 Skill 复用链路2现有的：

- 视频语义段落切分；
- 完整事实句提取；
- 精准知识讲解时间段定位；
- 原始证据保留；
- 科学边界控制。

但提供两种输出模式：

```text
navigation
reconstruction_base
```

---

# 2. 两种模式

## 2.1 navigation

用于链路2。

继续强调：

- 题目张力；
- 用户好奇；
- 短答案；
- 答案钩子；
- 回看价值。

## 2.2 reconstruction_base

用于链路3。

目标是：

> 提取相对完整、稳定、可跨视频标准化的最小可学习单元。

它保留完整事实句和时间戳规则，但不再要求：

- 必须有强反差；
- 必须能生成很吸引人的题目；
- 必须留下回看钩子。

它可以保留：

- 必要定义；
- 课程前置知识；
- 结构性知识；
- 缺少强张力但对主题完整性重要的知识；
- 单博主系列中的章节承接知识。

---

# 3. 输入

```json
{
  "task": "extract_source_knowledge",
  "extraction_mode": "navigation | reconstruction_base",
  "video": {
    "video_id": "v001",
    "creator_id": "c001",
    "title": "string",
    "duration_ms": 180000
  },
  "asr_segments": [],
  "ocr_segments": [],
  "visual_segments": [],
  "chapter_hints": [],
  "theme_hint": "optional"
}
```

---

# 4. 输出

```json
{
  "video_id": "v001",
  "extraction_mode": "reconstruction_base",
  "source_knowledge_points": [
    {
      "source_knowledge_id": "sk_v001_001",
      "title": "地球内部的放射性加热",
      "statement": "放射性元素衰变持续为地球内部提供热量",
      "summary": "放射性衰变是地球内部长期热量来源之一",
      "knowledge_type": "mechanism",
      "knowledge_dimension": "cause",
      "structural_role": "core",
      "topic": "地球演化",
      "subtopic": "内部热源",
      "intrinsic_difficulty": 2,
      "source_emphasis": 4,
      "start_ms": 61000,
      "end_ms": 105000,
      "supporting_spans": [],
      "evidence_text": "原始字幕或文案片段",
      "evidence_segment_ids": ["asr_18", "asr_19"],
      "visual_evidence_ids": ["frame_64s"],
      "question_candidate": "地球内部为什么仍然很热？",
      "answer_candidate": "放射性元素衰变会持续释放热量。",
      "confidence": 0.93,
      "checks": {
        "atomicity": "passed",
        "source_grounding": "passed",
        "time_span": "passed",
        "dimension": "passed"
      }
    }
  ],
  "status": "passed",
  "issues": []
}
```

---

# 5. 最小可学习单元

每个来源知识点必须满足：

1. 是完整陈述，不是标题、问题或标签；
2. 包含对象与明确关系、机制、结论、方法或事实；
3. 能脱离相邻知识点独立表述；
4. 保留必要条件和边界；
5. 可定位到视频中的真实讲解片段；
6. 有原始证据；
7. 不混入视频没有表达的推断；
8. 能用单一知识维度描述。

---

# 6. knowledge_type

建议枚举：

```text
concept
fact
mechanism
process
event
rule
method
claim
comparison
example
evidence
```

---

# 7. knowledge_dimension

必须选择一个主维度：

```text
definition
property
cause
mechanism
process
effect
comparison
condition
method
application
example
evidence
chronology
misconception_correction
```

这是后续防止过度去重的关键字段。

例如：

```text
大氧化事件是什么
→ definition

大氧化事件为什么发生
→ cause

大氧化事件如何发展
→ process

大氧化事件产生什么影响
→ effect
```

必须拆成四个来源知识点。

---

# 8. structural_role

```text
core
prerequisite
extension
example
transition
```

- `core`：视频核心新知识；
- `prerequisite`：理解后续内容需要的基础；
- `extension`：深化、边界或补充；
- `example`：用于帮助理解的案例；
- `transition`：连接两个章节的结构知识。

纯口头过渡不得因为叫 `transition` 就被保留，必须仍然有知识含量。

---

# 9. 原子性规则

出现以下情况必须拆分：

- 同时讲定义和原因；
- 同时讲原因和结果；
- 同时讲一般规律和例外条件；
- 同时讲原理和一个有独立学习价值的案例；
- 使用“此外、同时、另一方面、因此”连接两个独立结论；
- 一个候选无法用单一 `knowledge_dimension` 描述。

不应过度拆分：

- 同一机制的必要主语、条件和结论；
- 只有合在一起才完整的因果陈述；
- 为了解释一个结论所需的紧密证据。

---

# 10. 时间戳规则

`start_ms` 必须指向开始正式解释该知识的位置，不是：

- 关键词首次出现；
- 结论出现；
- 章节标题；
- 字幕第一次显示；
- 讲解中间。

`end_ms` 应覆盖核心解释闭环，但不得吞并下一个独立知识点。

跨多个不连续片段时：

- 主讲解写入 `start_ms/end_ms`；
- 其他片段写入 `supporting_spans`；
- 禁止生成横跨整条视频的巨大时间段。

---

# 11. reconstruction_base 的完整性规则

应覆盖视频主干，而不是只找“最好出题的几个点”。

建议目标：

```text
每个独立讲解段至少判断一次
每个核心章节至少保留一个主节点
重要定义、机制、方法、结果和前置均应覆盖
```

但不按固定数量凑知识点。

以下内容仍应排除：

- 纯背景闲聊；
- 广告；
- 重复复述；
- 只有主题没有结论；
- 纯情绪表达；
- 无法确定边界的半句话；
- 与主题无关的故事；
- 只有创作者态度、没有知识命题的观点。

---

# 12. 问题与答案字段

链路3的核心标准化依赖 `statement`，不是 `question_candidate`。

```text
statement
→ 用于标准化、去重和关系判断

question_candidate
→ 可供链路2或路径节点展示复用

answer_candidate
→ 来源视频的快速解释
```

问题和答案可以为空，但 `statement` 不得为空。

---

# 13. 与用户问题的隔离

输入不得包含当前用户研究问题。

来源知识点只能由视频内容决定。

错误：

```text
用户只想学雅思
→ 提取阶段只保留带“雅思”关键词的知识
```

正确：

```text
先完整提取视频知识
→ 后续路径阶段再判断哪些适合雅思目标
```

---

# 14. 自检清单

```text
[ ] 当前模式是否正确？
[ ] reconstruction_base 是否取消了题目张力硬门槛？
[ ] 每个知识点是否为完整陈述句？
[ ] statement 是否包含答案核心和必要边界？
[ ] 是否只表达一个主维度？
[ ] 时间戳是否从正式讲解开端开始？
[ ] 是否有原始证据？
[ ] 是否没有根据用户问题删减内容？
[ ] 是否覆盖视频主干而非只选最吸引人的点？
[ ] 是否排除了广告、闲聊和重复复述？
```
