# 统一视频解析 Harness

`VideoAnalysisHarness` 是产品级总编排器。它只执行一次共享视频预处理，然后并行调用两个内部能力模块：

- `understandingSupplements`：原链路1，生成理解补充；
- `knowledgeNavigation`：原链路2，生成知识点、问题和答案。

当前实现保持原有技术栈：链路1继续由 Node.js 运行，链路2继续由 Python 运行。总 Harness 负责共享 Environment、统一运行身份、根 Trace、并行调度和失败策略，不把两个能力合并成一个 Prompt。

## 输出合同

总 Harness 写入 `video_analysis_result.json`，Schema 为 `video-analysis.v1`。Backend 再把该结果转换为 H5 使用的 `video-project.v1`，因此 Harness 本身不绑定 `/api/media` 等展示层路径。

## 失败策略

- 理解补充失败：保留知识导航结果，状态为 `ready_with_fallbacks`；
- 知识导航失败：维持当前严格策略，整个分析任务失败；
- 两个能力必须读取同一份 `video-environment.v1`。

## 测试

```bash
PYTHONPATH=src python3 -m unittest discover tests
```
