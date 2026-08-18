# 见知·经纬：链路3 Harness v1

## 1. 这是什么

这是根据链路3 Skill 包构建的可运行 Harness。

它不是一个自由规划 Agent，而是：

> 确定性 Orchestrator + 独立 Skill 调用 + Schema 校验 + 缓存 + Grader + Trace + 局部重跑。

最终把多条相关视频重构成：

- 符合用户研究目标；
- 有明确阶段与学习顺序；
- 有前置、因果、时间、互补或观点关系；
- 每个节点可回到原视频片段；

的个性化学习路径。

## 2. 执行链路

```text
Task + Environment Snapshot
↓
S0 视频集合准入与主题识别
↓
S1 来源知识点提取（按视频并发，优先读取链路2缓存）
↓
S2 跨视频知识标准化
↓
S3 知识关系与来源校准
↓
TopicKnowledgeProfile 缓存
↓
S4 推荐研究问题（无问题时）
或
S5 研究问题解析（已有问题时）
↓
S6 知识筛选与学习路径编排
↓
确定性来源、图关系与时间检查
↓
S7 学习路径独立审核
↓
通过：发布
失败：依据 retry_step 局部重跑
```

## 3. 已实现能力

- Skill Registry，直接读取 `skills/skill-manifest.json`；
- S0 至 S7 固定调用顺序；
- `navigation / reconstruction_base` 双模式接口；
- 单视频来源知识缓存；
- 主题知识档案缓存；
- 用户路径缓存；
- 无第三方依赖的 JSON Schema 子集校验器；
- 模型 JSON 输出解析与一次自动修复；
- prerequisite 环路检测；
- 来源 ID、时间戳和可追溯性检查；
- 确定性学习时长计算；
- 独立路径审核；
- `retry_step` 局部重跑；
- JSONL Trace；
- 文件化运行状态；
- CLI、HTTP API、Fixture Provider 和端到端测试。

## 4. 快速运行

Node.js 20 及以上，无需安装第三方依赖。

```bash
npm test
npm run demo
npm run recommend
```

启动本地 API：

```bash
npm run serve
```

默认地址：

```text
http://localhost:8787
```

## 5. 模型 Provider

### Fixture Provider

默认使用：

```text
HARNESS_PROVIDER=fixture
```

用于本地测试和回归，不调用外部模型。

### OpenAI-compatible Provider

```bash
export HARNESS_PROVIDER=openai-compatible
export LLM_BASE_URL=https://your-endpoint/v1
export LLM_API_KEY=server-side-secret
export LLM_MODEL=your-model
npm run demo
```

API Key 只能放服务端环境变量，不得写入前端、Skill、Trace 或压缩包。人类已经制造过足够多的密钥泄漏事故，不必为统计数据再贡献一次。

## 6. 运行产物

默认写入：

```text
.runtime/
├── cache/
│   ├── source-knowledge/
│   ├── topic-profile/
│   └── learning-path/
├── runs/
└── traces/
```

### Trace

每个分析任务生成一份 JSONL：

```json
{
  "run_id": "...",
  "step": "knowledge_normalization",
  "event": "skill_completed",
  "duration_ms": 1432,
  "input_hash": "...",
  "output_hash": "..."
}
```

默认不记录 API Key，也不记录完整环境变量。

## 7. 更换研究问题

调用 `reconstruct` 时复用：

- 视频解析；
- 来源知识点；
- 标准知识节点；
- 知识关系；
- 来源校准。

只重新执行：

```text
S5 需求解析
→ S6 路径编排
→ 时间计算
→ S7 路径审核
```

## 8. 目录

```text
src/
├── api/
├── domain/
├── graders/
├── harness/
├── infrastructure/
├── providers/
├── services/
└── skills/

skills/        原始 Skill 包与 Schema
schemas/       Harness 包装输出 Schema
config/        执行配置
examples/      可直接运行的样例与模型 Fixture
tests/         Node 内置测试
```

## 9. 当前边界

v1 不负责：

- 视频下载、ASR、OCR 和关键帧提取；
- 外部知识自动补全；
- 事实联网核验；
- 大规模知识图数据库；
- 多用户协作；
- 自动考试。

这些应通过 Tool 或独立服务接入，而不是把所有责任继续扔给同一个 Prompt，仿佛 Prompt 是数字世界的万能胶。
