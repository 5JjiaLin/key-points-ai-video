# AGENTS.md — 划重点视频理解 Harness

本文件让任意 Agent 无需人工讲解即可正确使用本 Harness。先读完“黄金规则”，
再按“工作流”执行。深入的字段级契约见 `references/contracts.md`。

---

## 1. 这是什么

一个统一的视频理解 Harness，面向科普类视频，提供三条能力链路：

- **链路1 理解补充**：在观看中识别三类“用户可能卡住”的点，给出轻提示，
  点击弹出一张卡片帮助秒懂，且不打断播放。三类是：
  - `abstract_to_intuitive`：出现抽象数字/量级，博主没讲直观 → 生成对比卡片
  - `claim_verification`：出现用户可能质疑的说法（“真的吗？”）→ 中立双栏核验卡（**不生图**）
  - `knowledge_gap`：出现没解释的专业名词 → 一句话补懂卡片
- **链路2 知识导航**：提取并总结视频主要知识点，供快速预览；用户觉得有用
  可“添加”进知识池（喂给链路3）。
- **链路3 多视频重构**：把知识池里 3–10 个视频（同一博主合集，或同一知识
  领域的不同博主）+ 用户的学习方向，复用链路2 已提取的知识点重新排序，
  生成可系统学习的路径。每个路径节点都指回原视频的知识点片段。

面向两类用户：轻度观众（链路1、2 帮助更好地看视频）与重度学习者（链路3
系统性学习）。

---

## 2. 黄金规则（必须遵守）

1. **唯一入口是 Backend API。** 只通过 `scripts/harness_client.py`（或等价
   HTTP 调用）访问 Backend。**不要**自己直接编排链路1/2/3，除非在调试平台本身。
2. **绝不接触密钥。** `ARK_API_KEY`、`DOUBAO_API_KEY`、`DASHSCOPE_API_KEY`、
   `AGNES_API_KEY`、`LLM_API_KEY` 等只存在于服务端环境变量。不要把任何密钥
   写进请求体、日志、Trace、H5 或本包。
3. **只发布终态结果。** 任务状态为 `ready` / `ready_with_fallbacks`
   （单视频）或 `completed`（重构）才算成功。`failed` / `needs_review`
   时如实报告返回的错误，**不要编造**结果或路径。
4. **保留可追溯性。** result 的毫秒时间戳、源视频引用、路径节点的
   源视频ID+时间范围必须原样保留，产品要靠它跳回原片段。
5. **不暴露内部物。** 候选卡打分、审核 Trace、原始 prompt、
   `video-environment.v1` 证据是服务端契约，不要返回给 H5 消费者。

---

## 3. 配置

- 设置 `HARNESS_API_URL` 指向 Backend。默认 `http://127.0.0.1:8000`。
  远端部署时改为你自己的 HTTPS Backend 地址。
- 链路3 是内部服务（`127.0.0.1:8787`），只在本机深度健康检查时可见，
  不对外暴露。

### Preflight（开始前必做）

```bash
python3 scripts/harness_client.py health          # 单视频任务够用
python3 scripts/harness_client.py health --deep   # 多视频任务，需在服务器本机跑
```

单视频任务要求 `backend.status == "ok"`；多视频任务额外要求
`chain3.ok == true`。

---

## 4. 工作流

### A. 单视频分析（链路1 + 链路2）

上传本地视频，等待分析完成，并直接加入知识池：

```bash
python3 scripts/harness_client.py upload /abs/path/video.mp4 --wait --add-to-pool
```

查看已有任务：

```bash
python3 scripts/harness_client.py job JOB_ID       # 状态与进度
python3 scripts/harness_client.py result JOB_ID    # video-project.v1 结果
```

result 是公共产品契约 `video-project.v1`：含 `category`（8 领域之一）、
毫秒时间轴、知识点、链路1 补充卡（visual 路由带 qwen 生成的卡片图 +
轻提示贴图；claim_verification 是双栏模板无图）、链路2 知识点。

### B. 抖音导入

传公开 URL 或整段分享文案（勿用于需登录/未授权的内容）：

```bash
python3 scripts/harness_client.py douyin '分享文案或 https://v.douyin.com/.../' \
  --wait --add-to-pool
```

### C. 知识池

```bash
python3 scripts/harness_client.py pool             # 列出
python3 scripts/harness_client.py pool-add JOB_ID
python3 scripts/harness_client.py pool-remove JOB_ID
```

移出知识池只改成员关系，不删源视频或分析结果。

### D. 多视频重构（链路3）

前提：先按 `category` 领域挑选 3–10 个**同主题、已完成、已在池中**的视频
（路径只在同主题视频间才有意义）。

第一步，启动稳定知识层分析，等待问题推荐：

```bash
python3 scripts/harness_client.py reconstruct JOB1 JOB2 JOB3 \
  --mode auto --theme '可选主题提示' --wait
```

读取推荐的研究问题：

```bash
python3 scripts/harness_client.py reconstruction-result ANALYSIS_ID
```

让用户选择或编辑一个中立的研究问题，再生成个性化路径：

```bash
python3 scripts/harness_client.py build-path ANALYSIS_ID '用户确认的研究问题' --wait
```

轮询直到 `completed`。若为 `needs_review` / `failed`，报告错误，不要编造路径。

---

## 5. 状态机速查

| 场景 | 成功终态 | 失败终态 | 中间态 |
|------|----------|----------|--------|
| 单视频/抖音 | `ready`, `ready_with_fallbacks` | `failed`（`retryable=true` 时可 `POST /api/jobs/{id}/retry`） | queued/probing/transcribing/indexing/ocr/chain1/chain2/finalizing |
| 重构第一阶段 | `awaiting_question` | `failed`, `needs_review` | assessing/extracting/normalizing/building/recommending |
| 生成路径 | `completed` | `failed`, `needs_review` | planning/reviewing |

---

## 6. 契约与稳定性要点（服务端内部，Agent 无需改）

- **模型**：文本推理用 Doubao/Ark（可切 Agnes）；生图用通义 `qwen-image`
  （DashScope 异步接口）。换模型不改任何公共 HTTP 契约。
- **稳定性**：`ARK_TIMEOUT_MS=240000`、`ARK_MAX_RETRIES=1`、
  `CHAIN2_MAX_SEMANTIC_SEGMENTS_PER_REQUEST=8`、`LLM_TIMEOUT_MS=300000`、
  `CHAIN1_SUBPROCESS_TIMEOUT_SECONDS=5400`。
- **边界宽容解析**：模型输出的分类标签类字段不做严格 enum 校验（避免幻觉值
  拖垮整链），只有流程关键字段严格校验；JSON 畸形先自动修复一次再报错。
- **共享证据**：每个成功视频有一份不可变 `video-environment.v1` 快照
  （ASR/OCR/关键帧/语义段/hash）。链路1/2 读同一快照；链路3 复用快照和
  知识点，**不重复下载/ASR/OCR/抽帧**。

完整字段级契约见 `references/contracts.md`。

---

## 7. 一分钟自检

```bash
export HARNESS_API_URL=http://127.0.0.1:8000
python3 scripts/harness_client.py health
python3 scripts/harness_client.py pool
```

能拿到 `status: ok` 和知识池列表，即表示 Harness 就绪，可开始上述工作流。
