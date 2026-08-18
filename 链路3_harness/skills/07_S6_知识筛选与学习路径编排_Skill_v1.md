# S6：知识筛选与学习路径编排 Skill v1

## 1. Skill 定位

本 Skill 使用稳定知识图和结构化研究意图，生成当前用户目标下的学习路径。

它负责：

- 筛选；
- 必要前置保留；
- 分类；
- 排序；
- 阶段划分；
- 模板选择；
- 来源推荐；
- 缺口和未覆盖项说明。

它不得修改来源知识点或标准知识节点。

---

# 2. 输入

```json
{
  "task": "plan_learning_path",
  "theme": {},
  "analysis_mode": "single_creator_series | multi_creator_topic",
  "research_intent": {},
  "canonical_nodes": [],
  "relations": [],
  "source_alignments": [],
  "knowledge_gaps": [],
  "source_knowledge_points": [],
  "video_metadata": [],
  "user_context": {
    "completed_node_ids": [],
    "level": null
  }
}
```

---

# 3. 输出

```json
{
  "filter_decisions": [
    {
      "canonical_node_id": "cn001",
      "decision": "keep",
      "relevance_score": 0.94,
      "path_priority": 0.88,
      "reason": "属于雅思写作核心词汇",
      "kept_as_prerequisite": false,
      "matched_constraints": ["include:雅思写作"]
    }
  ],
  "learning_path": {
    "path_id": "p001",
    "title": "雅思写作词汇进阶路线",
    "goal": "掌握雅思写作常用词汇与表达",
    "template": "difficulty_path",
    "estimated_minutes": null,
    "coverage_note": "覆盖当前视频中的主要写作词汇",
    "stages": [
      {
        "stage_id": "s001",
        "title": "基础连接词",
        "goal": "掌握基本逻辑连接",
        "reason": "这些知识是后续复杂表达的前置基础",
        "knowledge_nodes": [
          {
            "canonical_node_id": "cn001",
            "display_title": "表示因果的基础连接词",
            "learning_goal": "能识别并使用基础因果连接",
            "reason_for_placement": "后续复杂论证依赖该能力",
            "recommended_source": {
              "video_id": "v001",
              "source_knowledge_id": "sk001",
              "start_ms": 61000,
              "end_ms": 105000,
              "selection_reason": "解释完整、表达清楚且片段长度适中"
            },
            "alternative_sources": [],
            "estimated_minutes": null
          }
        ]
      }
    ],
    "excluded_summary": [],
    "missing_prerequisites": [],
    "uncovered_user_requirements": []
  },
  "status": "passed",
  "issues": []
}
```

---

# 4. 筛选决策

只能使用：

```text
keep
exclude
lower_priority
uncertain
```

每个标准节点都必须有决策和原因。

## keep

直接符合目标或是必要前置。

## exclude

与目标无关或被用户明确排除。

## lower_priority

相关但不属于核心路径，可进入知识地图或延伸内容。

## uncertain

证据不足或和用户目标关系不明确。

---

# 5. 必要前置保留

当用户明确排除某类内容，但它是完成目标不可缺少的前置时：

- 可以保留；
- 必须设置 `kept_as_prerequisite=true`；
- 必须写明原因；
- 数量保持最小；
- 不得借“前置”之名塞回大量被排除内容。

---

# 6. 编排优先级

```text
用户硬约束
>
知识前置关系
>
用户目标相关度
>
分析模式
>
难度平滑
>
同类聚合
>
原视频顺序
```

发布时间、收藏顺序、视频编号、热度不能直接作为学习顺序。

---

# 7. 阶段划分

每个阶段必须：

1. 有明确学习目标；
2. 节点围绕同一任务或高度相关任务；
3. 节点数量适中；
4. 难度变化平滑；
5. 与前后阶段关系可解释；
6. 有明确的 `reason`。

禁止空泛阶段：

```text
第一部分
继续学习
更多知识
其他内容
```

---

# 8. 模板选择

优先级：

```text
用户明确指定
>
研究意图推断
>
知识结构推断
>
default_stage_path
```

## timeline_path

知识存在明确时间主线。

## difficulty_path

存在难度或前置进阶关系。

## scenario_path

按使用场景分类，场景之间不一定有严格顺序。

## chapter_path

适合同一博主系列和课程章节。

## viewpoint_comparison

用户明确要求比较来源观点，且存在已对齐的多来源命题。

## time_plan

用户提供每天时长、总天数或总时间。

---

# 9. 来源推荐

每个路径节点必须选择一个推荐来源。

推荐依据：

```text
知识覆盖完整度
表达清晰度
与当前目标匹配度
片段长度
来源置信度
是否为更好的解释
```

其他来源可以标记为：

```text
alternative
supplement
different_condition
different_viewpoint
```

不得仅因为某视频更热门就推荐。

---

# 10. 时间估算边界

Skill 不直接决定最终精确分钟数。

它只选择：

- 推荐视频片段；
- 是否需要多个来源；
- 是否需要阅读对比；
- 是否需要回顾。

Harness 后续根据：

```text
片段时长
+ 阅读时间规则
+ 多来源折扣
+ 回顾时间
```

确定最终时间。

因此本 Skill 中 `estimated_minutes` 可以为 `null` 或建议值，但不得作为最终真值。

---

# 11. 不得创造新知识

路径中的每个 `canonical_node_id` 必须存在于输入知识图。

缺少前置时：

```text
写入 missing_prerequisites
```

不得创建一个没有来源的伪节点。

---

# 12. 单博主模式策略

重点：

- 尊重作者原有课程逻辑；
- 修复发布时间和收藏顺序混乱；
- 合并重复章节；
- 标记补充篇；
- 标记缺失章节；
- 生成课程式路径。

但作者原顺序若明显违反知识前置，仍应以知识关系为准，并解释调整原因。

---

# 13. 多博主模式策略

重点：

- 一个标准节点只作为一个主学习节点；
- 选择最佳主讲来源；
- 其他来源作为补充；
- 共识、条件不同和分歧使用不同展示方式；
- 不强制把所有创作者都放进每个节点。

---

# 14. 用户问题超出范围

当 `coverage_assessment` 为 partially_supported 或 unsupported：

- 只生成当前视频真正覆盖的部分；
- 写入 `uncovered_user_requirements`；
- 不用外部知识补齐；
- 不假装路径完整。

---

# 15. 自检清单

```text
[ ] 每个标准节点是否有筛选决策？
[ ] 用户硬约束是否优先？
[ ] 必要前置是否最小化并解释？
[ ] 路径是否违反前置关系？
[ ] 阶段是否有清晰目标和原因？
[ ] 模板是否匹配研究意图？
[ ] 每个节点是否绑定真实来源和时间点？
[ ] 是否没有生成知识图之外的核心节点？
[ ] 多博主差异是否使用来源校准结果？
[ ] 覆盖不足是否诚实说明？
```
