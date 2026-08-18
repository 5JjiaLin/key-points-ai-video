# S2：跨视频知识标准化 Skill v1

## 1. Skill 定位

本 Skill 将多条视频中的 `SourceKnowledgePoint` 映射为稳定的 `CanonicalKnowledgeNode`。

它回答：

> 哪些来源知识点表达的是同一个独立命题？标准名称和标准陈述应该是什么？

它不生成学习顺序，不根据用户目标筛选，也不直接判断完整观点冲突。

---

# 2. 输入

```json
{
  "task": "normalize_cross_video_knowledge",
  "theme": {},
  "analysis_mode": "single_creator_series | multi_creator_topic",
  "source_knowledge_points": [],
  "existing_canonical_nodes": []
}
```

---

# 3. 输出

```json
{
  "canonical_nodes": [
    {
      "canonical_node_id": "cn001",
      "canonical_title": "原行星物质吸积",
      "canonical_statement": "太阳系早期物质通过引力、碰撞和聚集逐步形成原行星",
      "knowledge_type": "process",
      "knowledge_dimension": "process",
      "topic": "地球形成",
      "subtopic": "物质聚集",
      "intrinsic_difficulty": 2,
      "source_knowledge_ids": ["sk1", "sk8", "sk13"],
      "source_video_ids": ["v1", "v3"],
      "original_expressions": [
        "原行星吸积",
        "早期物质聚集",
        "太阳系尘埃逐渐结合"
      ],
      "support_strength": "multi_source",
      "merge_confidence": 0.88,
      "canonicalization_reason": "三者描述同一对象、同一过程和同一适用范围"
    }
  ],
  "unmerged_source_points": [],
  "ambiguous_groups": [],
  "status": "passed",
  "issues": []
}
```

---

# 4. 允许合并的必要条件

只有同时满足以下条件才允许合并：

1. 讨论对象相同；
2. 核心命题相同；
3. `knowledge_dimension` 相同或可证明完全等价；
4. 时间范围基本一致；
5. 适用条件基本一致；
6. 结论强度一致；
7. 合并后不会丢失独立学习价值；
8. 每个来源都能支持标准陈述。

---

# 5. 禁止过度去重

以下内容不得合并：

```text
定义 vs 原因
原因 vs 过程
过程 vs 结果
规则 vs 示例
一般规律 vs 特殊条件
基础解释 vs 明显更高级的深化机制
同一对象的不同属性
```

示例：

```text
大氧化事件发生了什么
大氧化事件为什么发生
大氧化事件产生了什么影响
```

必须形成至少三个标准节点。

英语示例：

```text
abandon 的含义
abandon 的使用场景
abandon 与 give up 的区别
abandon 在雅思写作中的用法
```

也必须分开。

---

# 6. 标准陈述规则

`canonical_statement` 必须：

- 是完整陈述句；
- 只表达一个核心命题；
- 不比任何来源更绝对；
- 保留共同适用范围和条件；
- 不混入外部知识；
- 能被所有映射来源支持；
- 使用中立、跨创作者的表述。

如果来源只存在部分重叠：

```text
建立较窄的共同节点
+
将额外内容保留为独立节点或后续互补关系
```

不得用宽泛总结把细节全部吞掉。

---

# 7. 单来源节点

并非所有标准节点都必须由多个视频支持。

某一视频提供独有知识时：

```json
{
  "support_strength": "single_source",
  "source_knowledge_ids": ["sk021"]
}
```

仍可形成标准节点，但后续关系判断需要标注其来源独有性。

---

# 8. ambiguous_groups

无法确认是否同一命题时，不得强行合并。

```json
{
  "ambiguous_group_id": "ag001",
  "source_knowledge_ids": ["sk1", "sk2"],
  "possible_relation": "same_or_complementary",
  "reason": "两者适用人群和时间范围不明确",
  "recommended_retry_step": "relation_building"
}
```

---

# 9. 处理流程

## Step 1：按对象和维度粗分组

先使用：

```text
topic
subtopic
knowledge_dimension
核心对象
```

建立候选组。

## Step 2：对齐命题槽位

比较：

```text
对象
关系/机制
条件
时间范围
结论强度
结果
```

## Step 3：决定合并、分开或待审

```text
same_proposition
→ 合并

related_but_distinct
→ 分开，交给关系 Skill

uncertain
→ ambiguous_group
```

## Step 4：生成标准名称和陈述

标准名称应短而稳定，标准陈述应完整而可验证。

## Step 5：校验来源映射

每个标准节点至少映射一个真实来源知识点。

---

# 10. 置信度建议

```text
≥ 0.85
→ 自动合并

0.68–0.85
→ 合并但标记 medium_confidence，进入抽样审核

< 0.68
→ 不自动合并，进入 ambiguous_groups
```

---

# 11. 模式差异

## single_creator_series

可以优先沿用创作者术语体系和章节命名，但仍以独立命题为准。

## multi_creator_topic

应使用中立标准名称，不偏向某位创作者的独有话术。

---

# 12. 自检清单

```text
[ ] 合并项是否对象相同？
[ ] 知识维度是否相同？
[ ] 条件和时间范围是否一致？
[ ] 标准陈述是否被所有来源支持？
[ ] 是否误合并定义、原因、过程或结果？
[ ] 是否保留所有来源映射和原始表达？
[ ] 单来源独有知识是否被保留？
[ ] 不确定项是否进入 ambiguous_groups？
[ ] 是否没有根据用户研究问题修改标准节点？
```
