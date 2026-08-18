# Codex 接入任务：链路1 Harness

## 目标

将本目录的链路1 Harness 接入当前 H5 项目，跑通：

```text
视频解析结果
→ 分类
→ 对应 Skill
→ 审核与仲裁
→ 前两类完整卡片生图
→ 验证真假结构化渲染
→ 输出给播放页时间轴
```

## 开始前

1. 先阅读项目根目录 `AGENTS.md`；
2. 阅读本目录 `README.md` 和 `HARNESS_ARCHITECTURE.md`；
3. 检查现有前后端、路由、状态管理、文件存储和 LLM 调用方式；
4. 不迁移现有技术栈；
5. 不把 `DASHSCOPE_API_KEY` 放进 H5；
6. 先列出准备修改的文件，再编码。

## 必须完成

### 1. 合并类型和 Orchestrator

优先复用现有目录结构。将 `src` 内的 Harness 模块迁移到后端或服务层，避免打进浏览器 bundle。

### 2. 接入视频解析结果

将已有 ASR、OCR、关键帧和语义分段转换为：

```ts
VideoEnvironmentInput
```

若当前语义分段尚未实现，先用句子级 ASR 片段作为 `semanticSegments`，但保留后续升级接口。

### 3. 接入 Route Classifier

使用项目现有 LLM 结构化输出能力实现 `JsonInvoker`，加载 `prompts/route-classifier.md`。

分类器只路由，不生成内容。

### 4. 接入三份 Skill

使用 `skills/` 中的原始 Skill 文档，不要合并成一个 Prompt。

分别实现：

```ts
SkillRegistry.abstractToIntuitive
SkillRegistry.knowledgeGap
SkillRegistry.claimVerification
```

必须保留原始输出，供 Adapter、Trace 和回归测试使用。

### 5. 调整 Skill 输出

确认：

- 抽象变直观一定输出完整卡片生图 Prompt；
- 知识断层一定输出完整卡片生图 Prompt；
- 验证真假不输出生图 Prompt；
- 前两类 Prompt 内包含少量固定问题和答案文字；
- 最终卡片规格为 310×180；
- 不要改回“只生成贴纸、代码填文字”。

### 6. 接入万相 2.7 Tool

服务端读取新的 `DASHSCOPE_API_KEY`。

调用：

```text
POST https://apihub.agnes-ai.com/v1/images/generations
model: wan2.7-image-pro
size: 2K
ratio: 16:9
extra_body.response_format: url
```

URL 返回后立即下载，裁切并持久化为 `930×540` 的 3 倍屏资源，H5 仍以 `310×180` CSS px 展示。生产环境改成现有对象存储，Demo 可以先保存到 `public/generated/chain1-cards`。

### 7. 接入 Visual Grader

当前代码只强制检查尺寸。使用现有视觉模型实现 `VisualSemanticInspector`，至少审核：

- 卡片问题和答案是否正确；
- 是否乱码或错字；
- 是否有额外文字；
- 视觉语义是否匹配；
- 是否出现 `must_not_show`。

失败后把具体修正指令交回万相 2.7，最多生成 3 次。

### 8. 接入播放页

播放页只读取最终结果，不执行 Skill 或生图：

```text
video.currentTime
→ 匹配 triggerAtMs
→ 出现轻提示
→ 点击后展示完整 cardImageUrl 或验证卡模板
```

### 9. 增加后台解析状态

建议：

```text
extracting
transcribing
reading_screen_text
building_timeline
running_chain1
running_chain2
generating_cards
ready
failed
```

视频只有在关键结果准备好后进入播放页。

### 10. 测试

至少覆盖：

- 65℃ → 抽象变直观；
- 胃肠功能紊乱 → 知识断层；
- 冰水就是不健康 → 验证真假；
- 作者已经用画面解释数字 → 抑制；
- 同一片段命中两类 → 仲裁；
- 生图失败 → 文字降级但视频仍 ready；
- 验证真假不调用生图模型；
- API Key 不进入客户端 bundle 和 Trace。

## 完成后汇报

1. 修改文件；
2. 运行命令；
3. 测试结果；
4. 真实 Skill / LLM / 万相 2.7 是否已调用；
5. 仍使用 Mock 的部分；
6. 未完成项；
7. 不要声称未验证的功能已经可用。
