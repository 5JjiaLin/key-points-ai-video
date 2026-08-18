# S0：视频集合准入与主题识别 Skill v1

## 1. Skill 定位

本 Skill 在多视频知识重构开始前执行，负责回答：

> 当前视频是否真的属于同一个可重构主题？哪些视频应进入本次知识档案？采用哪种来源处理模式更合理？

它不提取详细知识点，不判断精确重复数量，也不生成学习路径。

---

# 2. 输入

```json
{
  "task": "assess_video_set",
  "videos": [
    {
      "video_id": "v001",
      "creator_id": "c001",
      "title": "地球内部为什么仍然很热",
      "description": "string",
      "asr_summary": "string",
      "published_at": "2026-01-01T00:00:00Z",
      "series_hint": "optional",
      "user_selected": true
    }
  ],
  "user_theme_hint": "地球演化",
  "requested_analysis_mode": "single_creator_series | multi_creator_topic | auto"
}
```

---

# 3. 输出

```json
{
  "theme": {
    "theme_id": "topic_001",
    "title": "地球形成与早期演化",
    "scope_statement": "围绕地球形成、内部热源、大气演化与早期生命影响",
    "domain": "earth_science",
    "confidence": 0.92
  },
  "recommended_analysis_mode": "multi_creator_topic",
  "included_videos": [
    {
      "video_id": "v001",
      "role": "core",
      "relevance_score": 0.96,
      "reason": "直接解释地球内部热量来源"
    }
  ],
  "excluded_videos": [
    {
      "video_id": "v009",
      "role": "unrelated",
      "relevance_score": 0.24,
      "reason": "主要讨论火星殖民，与当前主题仅有弱背景关联"
    }
  ],
  "series_hints": [],
  "coverage_preview": {
    "likely_overlap": true,
    "likely_complementarity": true,
    "possible_viewpoint_difference": false,
    "note": "仅为低成本预判，不代表已完成精确关系识别"
  },
  "status": "passed",
  "issues": []
}
```

---

# 4. 视频角色

只能选择：

```text
core
prerequisite
extension
example
weakly_related
unrelated
```

含义：

- `core`：直接覆盖主题主干；
- `prerequisite`：为主干提供必要基础；
- `extension`：提供深化或边界；
- `example`：主要提供案例；
- `weakly_related`：只存在局部联系；
- `unrelated`：不应进入本次知识档案。

---

# 5. 主题范围规则

主题必须足够具体，能够形成知识结构。

不合格：

```text
科学
健康
英语
历史
人工智能
```

合格：

```text
地球形成与早期演化
痛风形成机制与日常管理
雅思写作词汇与论证表达
大模型从Transformer到Agent的基础脉络
```

主题不能窄到只覆盖一条视频，也不能宽到吞并多个互不相关的学习目标。

---

# 6. 处理流程

## Step 1：识别共同对象

判断视频是否围绕同一：

- 知识对象；
- 问题；
- 过程；
- 技能目标；
- 历史阶段；
- 系列课程。

关键词相同不是充分条件。

## Step 2：判断主题范围

生成：

- 中立主题标题；
- 范围陈述；
- 明确不包含的相邻主题。

## Step 3：逐视频判断角色

每条视频输出：

```text
相关度
角色
保留/排除原因
```

## Step 4：判断来源模式

### 推荐 single_creator_series

通常满足：

- 主要来自同一创作者；
- 存在系列编号、章节或连续教学；
- 视频之间有明显前后承接；
- 用户目标是“跟着某位博主系统学”。

### 推荐 multi_creator_topic

通常满足：

- 来自多个创作者；
- 每条视频覆盖主题的不同部分；
- 存在重复、互补、不同解释深度；
- 用户希望拼出完整理解或比较观点。

---

# 7. 准入阈值

建议：

```text
relevance_score ≥ 0.72
→ 默认纳入

0.48 ≤ relevance_score < 0.72
→ weakly_related，默认不作为主干，允许用户手动保留

relevance_score < 0.48
→ 默认排除
```

用户手动选择的视频不得静默删除，必须显示排除原因并允许重新加入。

---

# 8. 严格禁止

- 不在详细知识点尚未提取时宣称“有3条重复、2处冲突”；
- 不因为标题相似就判定同主题；
- 不因为同一博主发布就判定同一系列；
- 不将仅用于举例的视频当成主干；
- 不生成研究问题；
- 不生成标准知识节点；
- 不生成学习顺序。

---

# 9. 自检清单

```text
[ ] 主题是否足够具体？
[ ] included 视频是否真的覆盖主题范围？
[ ] 是否保留了用户手动选择但被排除的视频记录？
[ ] 是否避免用关键词重合代替语义判断？
[ ] 是否区分核心、前置、延伸和案例？
[ ] 推荐模式是否有来源结构依据？
[ ] coverage_preview 是否明确只是预判？
```
