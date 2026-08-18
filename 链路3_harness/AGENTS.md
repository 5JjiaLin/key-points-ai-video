# Codex 实现与修改指南

## 核心原则

1. 保持稳定知识层与动态路径层隔离。
2. 用户研究问题不得进入 S1、S2、S3 的基础输入。
3. 所有路径节点必须引用已有 `canonical_node_id`。
4. 所有标准节点必须映射至少一个 `source_knowledge_id`。
5. 所有来源知识点必须绑定真实 `video_id` 和时间段。
6. 路径规划和路径审核不得合并为一次模型调用。
7. 模型负责语义判断，代码负责 ID、图环、时间、缓存、Schema 和重试。
8. 修改 Skill 或 Schema 后必须运行 `npm test`。

## 不允许的捷径

- 不把发布时间直接当学习顺序；
- 不用关键词相似度直接完成知识去重；
- 不把表达不同直接判定为 conflict；
- 不在缺少前置时生成无来源知识节点；
- 不把完整 API Key 写进代码、日志、Fixture 或文档；
- 不在审核失败后无条件重跑全链路。

## 新增模型 Provider

实现：

```js
class Provider {
  async complete(request) {
    return '{"json":"string"}'
  }
}
```

请求对象包含：

- `skillId`；
- `systemPrompt`；
- `userPrompt`；
- `input`；
- `attempt`；
- `runId`。

## 新增 Skill

1. 添加 Skill Markdown；
2. 更新 `skills/skill-manifest.json`；
3. 在 `src/domain/constants.mjs` 注册；
4. 在 `src/skills/output-contracts.mjs` 增加校验；
5. 在 Harness 中确定调用位置、缓存边界和 retry_step；
6. 添加失败 Fixture 与测试。
