# S3：知识关系与来源校准 Skill v1

## 1. Skill 定位

本 Skill 在标准知识节点之间建立有证据的关系，并判断不同来源对同一命题的关系。

它回答：

> 这些知识节点怎样连接？不同视频是在重复、互补、讨论不同条件，还是存在真实分歧？

---

# 2. 输入

```json
{
  "task": "build_knowledge_relations",
  "theme": {},
  "analysis_mode": "single_creator_series | multi_creator_topic",
  "canonical_nodes": [],
  "source_knowledge_points": [],
  "video_metadata": [],
  "ambiguous_groups": []
}
```

---

# 3. 输出

```json
{
  "relations": [
    {
      "relation_id": "rel001",
      "source_node_id": "cn001",
      "target_node_id": "cn008",
      "relation": "prerequisite",
      "direction": "directed",
      "confidence": 0.87,
      "reason": "理解目标节点需要先掌握来源节点的基础定义",
      "evidence_source_knowledge_ids": ["sk1", "sk9"]
    }
  ],
  "source_alignments": [
    {
      "alignment_id": "align001",
      "canonical_node_id": "cn010",
      "alignment_type": "condition_difference",
      "shared_proposition": "低温饮品可能引发短暂不适",
      "source_positions": [
        {
          "source_knowledge_id": "sk3",
          "scope": "胃肠敏感人群",
          "position": "可能出现短暂不适"
        },
        {
          "source_knowledge_id": "sk8",
          "scope": "多数健康人",
          "position": "适量饮用通常不会造成长期损伤"
        }
      ],
      "reason": "讨论人群不同，不能直接判为冲突",
      "confidence": 0.89
    }
  ],
  "knowledge_gaps": [],
  "status": "passed",
  "issues": []
}
```

---

# 4. 第一版关系集合

## 4.1 学习结构关系

```text
prerequisite
advanced
parallel
example
```

## 4.2 因果与过程关系

```text
cause
result
process_step
```

## 4.3 时间关系

```text
chronological_before
chronological_after
```

## 4.4 内容关系

```text
similar
complementary
```

`duplicate` 原则上应在 S2 完成。若本 Skill 仍发现 duplicate，应返回给 `knowledge_normalization` 重跑，而不是继续保留两节点。

## 4.5 来源观点关系

```text
consensus
perspective_complement
condition_difference
conflict
insufficient_evidence
```

---

# 5. prerequisite 的严格定义

`A prerequisite B` 表示：

> 用户不理解 A，会明显阻碍其理解 B。

以下不是前置关系的充分条件：

- A 在视频中先出现；
- A 更简单；
- A 和 B 属于同一主题；
- 创作者先讲 A 后讲 B。

前置必须来自概念依赖、方法依赖、推理依赖或步骤依赖。

---

# 6. conflict 的严格判定

只有同时满足以下条件才允许输出 `conflict`：

1. 讨论同一对象；
2. 回答同一命题；
3. 时间范围对齐；
4. 适用条件对齐；
5. 定义口径对齐；
6. 结论强度可比较；
7. 两个结论不能同时成立；
8. 有原始视频证据。

不满足时优先选择：

```text
perspective_complement
condition_difference
insufficient_evidence
```

不同说法看起来不一样，并不意味着博主已经拔剑相向。

---

# 7. consensus

`consensus` 不等于多个视频都提到了同一个关键词。

必须满足：

- 命题已对齐；
- 结论方向一致；
- 条件没有实质冲突；
- 至少两个独立来源支持。

---

# 8. perspective_complement

两条内容回答同一大问题的不同维度，并可同时成立。

例如：

```text
地球内部热量来自早期形成残余热
地球内部热量也来自放射性元素衰变
```

不是冲突，而是多因素互补。

---

# 9. condition_difference

核心结论差异由以下条件造成：

- 人群不同；
- 时间范围不同；
- 剂量不同；
- 地域不同；
- 定义口径不同；
- 使用场景不同；
- 研究层级不同。

输出时必须写明条件差异。

---

# 10. 知识缺口

只有当现有知识节点明确依赖一个未覆盖的前置概念时，才输出缺口。

```json
{
  "gap_id": "gap001",
  "required_by_node_ids": ["cn008"],
  "missing_knowledge": "条件句基础",
  "gap_type": "missing_prerequisite",
  "evidence": "复杂让步表达的理解依赖条件句结构",
  "confidence": 0.82
}
```

不得自动用外部知识补齐。

---

# 11. 模式策略

## single_creator_series

优先判断：

```text
prerequisite
advanced
process_step
chronological
missing_prerequisite
```

需要参考：

- 系列编号；
- 作者明确的“上一集/下一集”；
- 章节口播；
- 视频发布时间。

但这些只能作为辅助证据，不能取代知识依赖。

## multi_creator_topic

优先判断：

```text
similar
complementary
consensus
perspective_complement
condition_difference
conflict
insufficient_evidence
```

---

# 12. 代码后验检查

Skill 输出后，Harness 必须确定性检查：

- 自环；
- 不存在的节点 ID；
- 重复关系边；
- prerequisite 环；
- 时间关系矛盾；
- 同一节点对同时出现互斥关系；
- duplicate 未回流标准化。

---

# 13. 自检清单

```text
[ ] 每条关系是否有明确语义依据？
[ ] 是否把先后出现误判为前置？
[ ] conflict 是否完成对象、命题、时间、条件和口径对齐？
[ ] 是否优先识别互补和条件不同？
[ ] 共识是否至少有两个独立来源？
[ ] 缺口是否确实被现有节点依赖？
[ ] 是否没有使用外部知识补齐缺口？
[ ] 所有关系是否附带来源证据？
```
