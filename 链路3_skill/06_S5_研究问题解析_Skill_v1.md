# S5：研究问题解析 Skill v1

## 1. Skill 定位

本 Skill 将用户选择或输入的自然语言研究问题，转换成可执行的知识编排约束。

它回答：

> 用户这次想学什么、不要什么、怎样组织、时间上有什么限制？

它不直接筛选知识点，不生成学习路径。

---

# 2. 输入

```json
{
  "task": "parse_research_question",
  "raw_query": "我只想学习雅思写作相关词汇，并从基础到高级排列",
  "theme": {},
  "analysis_mode": "single_creator_series | multi_creator_topic",
  "available_topics": [],
  "available_dimensions": [],
  "coverage_summary": {}
}
```

---

# 3. 输出

```json
{
  "research_intent": {
    "raw_query": "我只想学习雅思写作相关词汇，并从基础到高级排列",
    "goal": "雅思写作词汇学习",
    "knowledge_scope": ["vocabulary"],
    "include_topics": ["雅思写作"],
    "exclude_topics": ["生活口语", "旅游英语"],
    "must_keep_node_ids": [],
    "sort_strategy": "easy_to_hard",
    "group_strategy": "function_then_difficulty",
    "difficulty_range": null,
    "daily_duration_minutes": null,
    "total_days": null,
    "max_total_minutes": null,
    "require_comparison": false,
    "require_gap_detection": false,
    "preferred_template": "difficulty_path",
    "allow_required_prerequisites": true,
    "hard_constraints": [
      "只保留与雅思写作真实相关的内容"
    ],
    "soft_preferences": [
      "优先从基础到高级"
    ]
  },
  "coverage_assessment": {
    "status": "fully_supported",
    "supported_scope": ["雅思写作词汇"],
    "unsupported_scope": [],
    "message": "当前视频能够覆盖该目标的主要内容"
  },
  "ambiguities": [],
  "status": "passed",
  "issues": []
}
```

---

# 4. 必须解析的字段

- 用户目标；
- 知识范围；
- 包含主题；
- 排除主题；
- 分类方式；
- 排序方式；
- 难度；
- 时间限制；
- 是否需要观点对比；
- 是否需要缺口分析；
- 结果模板；
- 是否允许保留必要前置。

---

# 5. 硬约束与软偏好

必须区分。

## hard_constraints

用户明确使用：

```text
只要
不要
必须
限定
最多
每天
7天内
```

通常属于硬约束。

## soft_preferences

用户使用：

```text
优先
最好
尽量
更偏向
```

通常属于软偏好。

不得把模型推测的偏好写成硬约束。

---

# 6. 策略枚举

## sort_strategy

```text
source_order
easy_to_hard
hard_to_easy
chronological
frequency_desc
importance_desc
prerequisite_order
custom
```

## group_strategy

```text
none
topic
subtopic
scenario
function
chapter
stage
creator_viewpoint
function_then_difficulty
```

## preferred_template

```text
timeline_path
difficulty_path
scenario_path
chapter_path
viewpoint_comparison
time_plan
default_stage_path
```

---

# 7. 解析原则

1. 用户明确包含项优先；
2. 用户明确排除项必须保留；
3. “从零开始”通常表示允许必要前置；
4. “只学习X”不能退化为关键词筛选；
5. 必须判断知识实际适用性；
6. 时间限制必须转换成可计算字段；
7. 不把未说出的用户水平当作事实；
8. 不生成学习路径；
9. 不修改稳定知识节点。

---

# 8. 覆盖评估

只能选择：

```text
fully_supported
partially_supported
unsupported
```

例如：

```text
用户要学雅思写作
视频只包含旅游口语
```

应输出：

```json
{
  "status": "unsupported",
  "supported_scope": [],
  "unsupported_scope": ["雅思写作"],
  "message": "当前视频主要覆盖旅游口语，无法支持雅思写作学习路径"
}
```

不得偷偷调用外部知识补齐。

---

# 9. 歧义处理

例如：

```text
帮我学最重要的部分
```

“最重要”可能指：

- 视频强调最多；
- 对主题理解最关键；
- 对考试最重要；
- 对实际使用最重要。

输出：

```json
{
  "ambiguity": "importance_basis",
  "possible_interpretations": [],
  "default_resolution": "theme_core_importance"
}
```

产品可以使用默认解释，也可以要求用户补充。

---

# 10. 自检清单

```text
[ ] 用户目标是否清楚？
[ ] 硬约束和软偏好是否分开？
[ ] include/exclude 是否来自用户真实表达？
[ ] 是否把“只学X”误做成关键词筛选？
[ ] 时间限制是否可计算？
[ ] coverage_assessment 是否诚实？
[ ] 是否没有生成路径或删除知识点？
[ ] 是否没有假设用户未提供的水平和背景？
```
