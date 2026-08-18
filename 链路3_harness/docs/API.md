# HTTP API

## POST /api/analysis

创建分析任务，立即返回202。

```json
{
  "videos": [],
  "requested_analysis_mode": "auto",
  "theme_hint": "地球演化",
  "research_question": "按时间顺序整理"
}
```

响应：

```json
{
  "analysis_id": "analysis_xxx",
  "status": "created"
}
```

## GET /api/analysis/{id}/status

```json
{
  "analysis_id": "analysis_xxx",
  "status": "normalizing_knowledge",
  "progress": 40,
  "current_step": "knowledge_normalization"
}
```

## GET /api/analysis/{id}/path

分析未完成时返回202；完成后返回结果。

## POST /api/analysis/{id}/reconstruct

```json
{
  "research_question": "比较不同视频中的共同点和补充"
}
```

该接口复用稳定知识档案，不重新执行S0至S3。
