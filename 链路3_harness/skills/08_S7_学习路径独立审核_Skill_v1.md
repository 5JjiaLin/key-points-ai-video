# S7：学习路径独立审核 Skill v1

## 1. Skill 定位

本 Skill 独立审核候选学习路径是否真正符合用户目标和知识约束。

它不能读取路径编排 Skill 的隐藏推理，只读取：

- 稳定知识档案；
- 结构化研究意图；
- 候选路径；
- 来源证据；
- 确定性代码检查结果。

路径生成与审核必须分开调用。

---

# 2. 输入

```json
{
  "task": "review_learning_path",
  "theme": {},
  "analysis_mode": "single_creator_series | multi_creator_topic",
  "research_intent": {},
  "coverage_assessment": {},
  "canonical_nodes": [],
  "relations": [],
  "source_alignments": [],
  "knowledge_gaps": [],
  "source_knowledge_points": [],
  "candidate_path": {},
  "deterministic_checks": {
    "schema_valid": true,
    "all_ids_exist": true,
    "all_nodes_traceable": true,
    "prerequisite_cycle_found": false,
    "order_respects_prerequisites": true,
    "duration_valid": true
  }
}
```

---

# 3. 输出

```json
{
  "passed": false,
  "score": 78,
  "dimension_scores": {
    "goal_alignment": 16,
    "coverage": 13,
    "constraint_compliance": 12,
    "knowledge_order": 11,
    "stage_quality": 10,
    "source_traceability": 10,
    "time_feasibility": 6
  },
  "issues": [
    {
      "issue_id": "issue001",
      "type": "missing_prerequisite",
      "severity": "high",
      "affected_node_ids": ["cn021"],
      "message": "该节点缺少必要的条件句基础",
      "retry_step": "path_planning",
      "repair_instruction": "优先加入现有知识图中的条件句节点；不存在时标记缺口"
    }
  ],
  "approved_path": null,
  "status": "failed"
}
```

---

# 4. 评分维度

总分 100：

```text
20 目标匹配
15 覆盖与遗漏
15 用户约束
15 前置、因果与时间关系
15 阶段划分和难度平滑
10 来源可追溯
10 时间可行性
```

---

# 5. 通过条件

```text
总分 ≥ 85
且无 high severity issue
且确定性硬检查全部通过
```

如果代码硬检查失败，模型不得以整体观感良好为由判通过。

---

# 6. 必查问题

## 6.1 目标匹配

- 是否真正回应研究问题？
- 是否选择了正确结果模板？
- 是否把普通摘要冒充学习路径？

## 6.2 约束

- 是否包含用户明确排除内容？
- 是否满足时间和难度限制？
- 必要前置是否被滥用？

## 6.3 知识质量

- 是否遗漏关键节点？
- 是否存在明显重复？
- 是否违反前置关系？
- 是否把互补、条件不同或分歧混在一起？

## 6.4 阶段质量

- 每个阶段是否有明确目标？
- 节点是否同类聚合？
- 难度是否跳跃？
- 顺序是否能解释？

## 6.5 来源

- 每个节点是否有真实来源？
- 时间点是否有效？
- 推荐视频是否确实讲解该节点？
- 是否出现视频中没有的 AI 扩写？

## 6.6 时间

- 总时长是否由真实片段支持？
- 每天时长限制是否可执行？
- 是否把多个重复来源全部叠加造成虚高？

---

# 7. retry_step

只能选择：

```text
intent_parsing
video_set_assessment
source_knowledge_extraction
knowledge_normalization
relation_building
knowledge_filtering
path_planning
source_selection
duration_calculation
manual_review
```

不得输出：

```text
retry_all
try_again
optimize
```

---

# 8. 局部修复映射

```text
目标理解错误
→ intent_parsing

无关视频污染
→ video_set_assessment

来源知识点遗漏或切分错误
→ source_knowledge_extraction

标准节点过度合并
→ knowledge_normalization

前置、因果或观点关系错误
→ relation_building

保留和排除错误
→ knowledge_filtering

顺序、阶段或模板错误
→ path_planning

推荐片段错误
→ source_selection

时间不合理
→ duration_calculation
```

Harness 只重跑受影响步骤及其下游，不重新执行无关前置步骤。

---

# 9. 审核独立性

审核 Skill 不得：

- 为生成结果找借口；
- 直接重写整条路径后自行判通过；
- 忽略确定性硬检查；
- 因页面看起来完整而放过无来源节点；
- 用外部知识补齐缺口后判通过；
- 用“总体合理”掩盖高严重度错误。

---

# 10. 自检清单

```text
[ ] 是否逐项核对用户研究意图？
[ ] 是否检查用户明确排除内容？
[ ] 是否检查每个节点来源？
[ ] 是否检查前置顺序和难度跳跃？
[ ] 是否检查模板是否匹配？
[ ] 是否检查AI无依据扩写？
[ ] 是否尊重 deterministic_checks？
[ ] retry_step 是否精准定位？
[ ] 高严重度问题存在时是否拒绝通过？
```
