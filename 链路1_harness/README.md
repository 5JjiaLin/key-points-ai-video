# 链路1 Harness

这是可直接交给 Codex 接入现有项目的链路1基础 Harness。

它整合三份独立 Skill：

- `abstract-to-intuitive.skill.md`：抽象数据直观化；
- `knowledge-gap.skill.md`：知识断层；
- `claim-verification.skill.md`：视频说法验证。

三个 Skill 保持独立，Harness 负责分类、调度、统一输出、冲突仲裁、Trace、Grader 和生图。

## 已锁定的渲染规则

```text
抽象变直观
→ Skill 输出问题、答案、完整卡片生图 Prompt
→ Harness 调用万相 2.7
→ 直接生成包含少量中文文字的 2K 完整卡片图片，按 310×180 CSS 尺寸展示

知识断层
→ Skill 输出问题、答案、完整卡片生图 Prompt
→ Harness 调用万相 2.7
→ 直接生成包含少量中文文字的 2K 完整卡片图片，按 310×180 CSS 尺寸展示

验证真假
→ Skill 输出问题、答案、核验状态与条件
→ 不调用生图模型
→ H5 使用固定验证卡组件填充字段
```

“框架限定”指图片在 H5 中出现的位置、尺寸、容器、展开方式和动画，不是用代码重新拼装图片内部文字。

## Harness 五要素

### Task

顶层任务为 `analyze_video_understanding_supplements`，输入已经解析好的视频时间轴环境，输出最终补充卡时间轴。

### Environment

每次运行生成不可变 `EnvironmentSnapshot`，记录视频哈希、ASR、OCR、视觉信息、Skill 版本和模型版本。

### Tools

- Route Classifier
- 三个 Skill Runner
- Wan 2.7 Full Card Image Tool
- 本地卡片资源持久化与裁切
- Content Grader
- Visual Grader
- Trace Store

### Trace

每次运行写入 `.jsonl`：分类、Skill 输出、审核、仲裁、生图、重试与失败原因。密钥字段自动脱敏。

### Grader

- Content Grader：检查字段、路由边界、Prompt 和触发时间；
- Arbiter：处理重复、时间冲突和提示频率；
- Visual Grader：检查完整卡 `930×540`、轻提示贴图 `120×120` 的 3 倍屏落盘尺寸，并可接入视觉模型做文字和语义审核。

## 快速运行 Mock Demo

```bash
npm install
npm run demo
```

Mock Demo 不调用真实模型和生图 API，只验证完整 Harness 流程。

## 接入真实万相 2.7

1. 撤销任何已经公开过的密钥；
2. 复制 `.env.example` 为服务端环境变量；
3. 配置新的 `DASHSCOPE_API_KEY`；
4. 使用 `WanChain1ImageTool`；
5. 不允许 H5 直接调用百炼生图 API。

```ts
import {
  WanChain1ImageTool,
  Chain1Harness,
  DEFAULT_CONFIG,
  LocalCardAssetStore,
} from "./src/index.js";

const store = new LocalCardAssetStore(DEFAULT_CONFIG.assetDirectory);
const imageTool = new WanChain1ImageTool(DEFAULT_CONFIG, store);
```

万相 `wan2.7-image-pro` 完整卡请求使用 2K 的 `2560×1440`，轻提示贴图使用 `2048×2048`。资源下载后分别保存为适配 3 倍屏的 `930×540` 与 `120×120` PNG；H5 展示尺寸仍为 `310×180` 和 `40×40` CSS px。Prompt 仍按 310×180 小卡约束构图，并把关键文字放在中心安全区。

## 必须由 Codex 接入的部分

这个包不会猜测你现有项目使用哪家 LLM、后端框架或对象存储。Codex 需要接入：

1. 现有 LLM 的结构化调用器；
2. 三份 Skill 文档到 Skill Runner；
3. 视频 ASR/OCR/视觉解析后的 `VideoEnvironmentInput`；
4. 视觉语义审核模型；
5. 生产对象存储；
6. H5 播放页读取最终 `supplements`。

详细任务见 `CODEX_INTEGRATION_TASK.md`。

## 读取共享视频时间轴

链路2 Harness 的 `harness preprocess` 会生成链路1可直接使用的
`video_environment.json`。本包提供运行时校验器：

```bash
npm run validate:environment -- /path/to/video_environment.json
```

真实 Harness 调用时使用 `loadVideoEnvironmentFile(path)` 读取，然后交给
`Chain1Harness.run(environment)`。校验器会拒绝没有带时间戳 ASR 或语义片段的假“已解析”输入。
