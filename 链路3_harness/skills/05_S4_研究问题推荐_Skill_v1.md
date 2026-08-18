# S4：研究问题推荐 Skill v1

## 1. Skill 定位

本 Skill 根据已形成的稳定主题知识档案，推荐 3 至 4 个可执行的研究问题。

它回答：

> 当前这批视频最值得以哪些方式被重构和学习？

它不解析用户自定义问题，不筛选知识点，也不生成最终路径。

---

# 2. 输入

```json
{
  "task": "recommend_research_questions",
  "theme": {},
  "analysis_mode": "single_creator_series | multi_creator_topic",
  "canonical_nodes_summary": [],
  "relation_summary": {},
  "coverage_summary": {
    "node_count": 28,
    "topic_count": 5,
    "has_chronology": true,
    "has_prerequisite_graph": false,
    "has_viewpoint_alignment": true,
    "has_knowledge_gaps": true
  }
}
```

---

# 3. 输出

```json
{
  "recommended_questions": [
    {
      "question_id": "rq001",
      "question": "地球46亿年经历了哪些关键阶段？",
      "goal_label": "时间主线",
      "expected_template": "timeline_path",
      "reconstruction_strategy": {
        "group": "chronology",
        "sort": "chronological",
        "filter": "core_events"
      },
      "reason": "当前知识包含明确时间节点和演化阶段",
      "feasibility_score": 0.94
    }
  ],
  "status": "passed",
  "issues": []
}
```

---

# 4. 推荐问题硬规则

每次输出：

```text
3至4个
```

每个问题必须：

1. 能由当前视频知识档案覆盖；
2. 能转换成筛选、分类、排序、对比或时间约束；
3. 代表不同编排维度；
4. 有明确用户收益；
5. 不依赖大量外部知识；
6. 不等价于普通摘要请求；
7. 语言自然，用户一眼知道结果会长什么样。

---

# 5. 推荐维度

可以从以下维度选择，但不能机械凑满：

```text
时间主线
难度进阶
章节重构
场景分类
观点对比
核心主干
查重补缺
时间计划
方法流程
因果链路
```

---

# 6. 分析模式偏好

## single_creator_series

优先推荐：

- 正确课程顺序；
- 前置到进阶；
- 快速学习路线；
- 缺失章节检查；
- 按天学习计划。

## multi_creator_topic

优先推荐：

- 完整主题结构；
- 共识与差异；
- 重复与独有补充；
- 时间或因果主线；
- 当前知识缺口。

---

# 7. 不合格问题

```text
帮我总结这些视频
这些视频讲了什么
给我一个报告
分析一下
有哪些重点
```

原因：无法形成稳定的筛选和编排约束。

---

# 8. 覆盖不足

某个维度看起来有吸引力，但当前知识不足时不得推荐。

例如：

```text
只有两个零散时间点
→ 不推荐“完整时间线”

没有同命题的多来源表达
→ 不推荐“观点冲突对比”
```

---

# 9. 多样性检查

推荐的 3 至 4 个问题不能只是换词复述。

错误：

```text
这些视频的时间顺序是什么？
按时间整理这些视频。
这些知识经历了哪些阶段？
```

本质都属于同一时间路径。

---

# 10. 自检清单

```text
[ ] 是否输出3至4个问题？
[ ] 每个问题都能由当前知识覆盖吗？
[ ] 每个问题能转成明确编排策略吗？
[ ] 是否覆盖不同维度？
[ ] 是否避免普通摘要问题？
[ ] expected_template 是否匹配知识结构？
[ ] feasibility_score 是否有实际覆盖依据？
```
