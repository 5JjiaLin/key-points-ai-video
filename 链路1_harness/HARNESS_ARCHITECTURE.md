# 链路1 Harness 架构

## 1. 主流程

```text
视频上传并完成 ASR / OCR / 关键帧解析
↓
创建 Task
↓
冻结 Environment Snapshot
↓
按语义片段建立 Candidate Window
↓
Route Classifier
├─ abstract_to_intuitive
├─ knowledge_gap
├─ claim_verification
└─ discard
↓
调用对应 Skill
↓
Adapter 转为统一候选结构
↓
Content Grader
↓
Arbiter：跨 Skill 去重、时间冲突、频率控制
↓
┌──────────────────────────────┬──────────────────────────────┐
抽象变直观 / 知识断层          验证真假
↓                              ↓
万相2.7生成完整卡片图片         固定验证卡结构化字段
↓
持久化并裁切为310×180
↓
Visual Grader
↓
最终 Supplement Timeline
```

## 2. 分类先于 Skill

Route Classifier 只做路由，不生成问题、答案或图片 Prompt。

```text
不知道数字是什么感觉 → 抽象变直观
不知道词是什么意思 → 知识断层
知道句意但不知道对不对 → 验证真假
没有明显需要 → discard
```

允许一个次路由，但只有两个分类置信度接近且确实是独立需求时才调用。不要默认把每个片段交给三个 Skill，模型调用不是集体晨会。

## 3. 三类 Skill 最终产物

### 抽象变直观

必须输出：

- 原文原子数据；
- 是否已被作者直观化；
- 问题；
- 短答案；
- 完整卡片视觉结构；
- 完整卡片生图 Prompt；
- 触发时间和展示等级。

如果作者通过口播、现实参照或画面已经解决尺度感，必须抑制。

### 知识断层

必须输出：

- 原文概念；
- 句内唯一 Top1；
- 问题；
- 短答案；
- 一个主贴纸的视觉语义；
- `must_show` / `must_not_show`；
- 完整卡片生图 Prompt；
- 触发时间和展示等级。

### 验证真假

必须输出：

- 原始说法；
- 标准化命题；
- 自然质疑焦点；
- 核验状态；
- 问题；
- 中立答案；
- 条件和证据摘要；
- 触发时间和展示等级。

此类强制 `visual.required = false`，绝不调用生图 Tool。

## 4. 生图规则

抽象变直观和知识断层直接生成完整卡片，不拆成“贴纸 + 程序文字”。

```text
Skill 完整卡片 Prompt
→ Content Grader
→ wan2.7-image-pro 2K / 2560×1440
→ 下载原图
→ 930×540 居中裁切，H5 以 310×180 CSS px 展示
→ Visual Grader
```

Visual Grader 最终需要视觉模型检查：

- 问题是否逐字正确；
- 答案是否逐字正确；
- 是否有错字、乱码、额外文字；
- 贴图是否匹配语义；
- 是否出现 `must_not_show`；
- 图片是否仍适配 310×180。

当前代码已提供尺寸审核和语义审核接口。Codex 需要接入现有视觉模型。

## 5. 仲裁规则

1. 同一片段或高度重叠片段，只保留一个前台轻提示；
2. 其他候选可被抑制或降为 `list_only`；
3. 默认完整提示间隔至少 15 秒；
4. 每分钟最多 2 个主动提示；
5. 三个 Skill 的原始分数不能直接比较；
6. Adapter 后使用统一 `globalPriority`；
7. 被抑制候选也必须进入 Trace。

## 6. 最终 H5 数据

```json
{
  "id": "candidate_seg-2_abstract_0",
  "type": "abstract_to_intuitive",
  "sourceText": "长期饮用65℃以上的热饮更值得注意",
  "startMs": 31000,
  "endMs": 35600,
  "triggerAtMs": 36100,
  "displayMode": "auto_prompt",
  "question": "65℃有多烫？",
  "answer": "已经明显烫口，不再只是温热",
  "renderMode": "full_generated_image",
  "cardImageUrl": "/generated/chain1-cards/xxx.webp",
  "cardWidth": 310,
  "cardHeight": 180
}
```

验证真假则使用：

```json
{
  "renderMode": "verification_template",
  "question": "冰水一定都不健康吗？",
  "answerLabel": "表达过于绝对",
  "answer": "不能一概而论，需要结合人群、饮用量和身体状态判断。"
}
```
