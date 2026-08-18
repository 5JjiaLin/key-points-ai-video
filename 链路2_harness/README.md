# 划重点知识点问答 Harness

当前 H5 生产主路径为：

```text
共享 VideoEnvironmentV1
→ 按分析块选择知识点
→ 跨块去重和时间边界整理
→ 每个知识点直接输出单个问题、解答、时间段和证据 ID
```

生产主路径只使用知识点选择规则。目录中原有三候选卡和审核代码仅保留为旧 CLI 评测兼容，不会被 H5 上传主路径调用，也不会进入 `chain2_result.json`。

旧 CLI 评测 prompt 资产包括：

- `知识点优化 Skill v11`：张力三元组 + 答案钩子 + 同批去重。
- `通用科普出题 Skill v29`：每知识点 3 候选 + 自然回看理由。
- `科普题目审核 Skill v7`：候选排序 + 32 分深审 + 承诺兑现检查。

## 共享视频预处理（推荐生产路径）

链路1和链路2共用同一份“ASR 主干 + 选择性 OCR/关键帧 + 长视频分块”时间轴：

```bash
pip install -e '.[media]'
harness preprocess \
  --manifest cases/videos.jsonl \
  --out runs/preprocessed
```

每个 case 产出：

- `video_environment.json`：链路1的 `VideoEnvironmentInput`；
- `transcript.md`：链路2的带时间戳 sidecar；
- `analysis_chunks.json`：默认 4 分钟一块、12 秒重叠；
- `keyframes/`：数字、图表、画面指向和场景变化位置的关键帧；
- `status.json`：可映射到上传页的解析状态。

顶层还会生成 `videos.preprocessed.jsonl`，可直接交给现有 `harness run`：

```bash
harness run \
  --manifest runs/preprocessed/videos.preprocessed.jsonl \
  --runs 1 \
  --out runs/latest
```

OCR 在 macOS 使用 Vision；不可用时仍会保留关键帧，不阻断 ASR 主流程。ASR 无可用结果时会明确失败，不会静默回退到固定 12 帧并冒充完整解析。

第一版不改 iOS 前端。CLI 会读取视频路径；如果 manifest 提供 `sidecar_text_path`，优先用文本测试；如果没有 sidecar，会用本机 `ffmpeg` 按时间线均匀抽取关键帧，压缩成 JPEG data URL，再按“时间戳文本 + 图片”的多模态序列传给 Doubao/Ark。harness 不设置本地视频大小上限；实际可处理大小主要由本机抽帧耗时、图片数量、模型上下文和接口限制决定。

## 安装

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e harness
```

真实 Doubao/Ark 调用需要二选一配置 API Key：

```bash
export DOUBAO_API_KEY="..."
# 或
export ARK_API_KEY="..."
```

模型/Endpoint ID 也支持两种命名：

```bash
export DOUBAO_MODEL="doubao-seed-2-0-pro"
# 或
export ARK_API_ENDPOINT_ID="doubao-seed-2-0-pro"
export DOUBAO_ENDPOINT="https://ark.cn-beijing.volces.com/api/v3/responses"
```

默认使用火山方舟 Responses API。若显式把 `DOUBAO_ENDPOINT` 设为
`https://ark.cn-beijing.volces.com/api/v3/chat/completions`，provider 会回退到旧
Chat Completions 请求格式。

## Manifest

`harness/cases/videos.jsonl` 每行一个 JSON：

```json
{"case_id":"case_001","video_id":"video_001","video_path":"videos/video_001.mp4","title":"视频标题","duration_seconds":180,"language":"zh-CN","sidecar_text_path":"transcripts/video_001.md"}
```

路径相对 manifest 文件所在目录解析。

`sidecar_text_path` 可省略。省略后 harness 会从 `video_path` 指向的视频中抽取关键帧并传给多模态模型；如果 API 层因为请求体或模型能力拒绝，harness 会暴露真实错误。

当前默认不是上传完整视频，而是抽关键帧：

```bash
export HARNESS_FRAME_COUNT=12
export HARNESS_FRAME_MAX_EDGE=768
```

这对应“时序分片 + 关键帧图像 + 时间戳提示”的大视频解析方式，避免把几十 MB 或数百 MB 的原视频 base64 直接塞进请求体。

如果要让 Ark/Doubao 通过 Files API 读取原视频：

```bash
export HARNESS_VIDEO_INPUT_MODE=file
export ARK_FILES_ENDPOINT=https://ark.cn-beijing.volces.com/api/v3/files
export ARK_FILE_PURPOSE=user_data
export ARK_FILE_INPUT_TYPE=input_video
export ARK_FILE_READY_RETRIES=12
export ARK_FILE_READY_RETRY_DELAY_SECONDS=5
```

File API 模式不会在 ingestion 层抽帧或设置本地大小上限；真实上限由 Ark/Doubao 接口、模型能力和超时决定。

## CLI

```bash
harness run --manifest harness/cases/videos.jsonl --runs 3 --out harness/runs/latest
harness judge --run harness/runs/latest
harness report --run harness/runs/latest
```

上面默认就是 `--provider doubao`。如果只测试本地工程链路，再显式传 `--provider mock`。

没有 API key 时可以用 mock provider 验证工程链路：

```bash
python3 -m huazhongdian_harness.cli run --manifest harness/cases/videos.jsonl --runs 1 --out harness/runs/mock --provider mock
python3 -m huazhongdian_harness.cli judge --run harness/runs/mock --provider mock
python3 -m huazhongdian_harness.cli report --run harness/runs/mock
```

## 输出

H5 生产主路径生成：

- `chunk_candidates.json`
- `knowledge_points.json`
- `chain2_result.json`

`chain2_result.json` 不包含 `cards` 或 `audits`；每个 `knowledgePoints` 条目直接包含 `question`、`answer`、`startMs`、`endMs` 和 `evidenceSegmentIds`。

以下仅是旧 CLI 评测模式输出：

每个 case 会生成：

- `knowledge_points.json`
- `card_candidates.json`
- `cards.json`
- `candidate_audit.json`
- `raw.json`
- `evaluations.json`

`harness run` 先生成 `card_candidates.json`；`harness judge` 完成 v7 排序审核后生成最终 `cards.json`。

顶层会生成：

- `summary.json`
- `report.md`
