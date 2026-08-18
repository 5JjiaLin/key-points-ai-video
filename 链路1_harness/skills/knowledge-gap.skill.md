---
name: chain1-knowledge-gap
description: 识别科普视频中普通用户不理解、作者未解释且会妨碍主线的术语、分类、缩写或专业表达，选择句内Top1并生成一句话解释、完整310×180卡片生图Prompt与时间轴结果。不处理数字尺度和说法真假。
metadata:
  version: "2"
  mode: production
---

# 知识断层识别 Skill v2

## 1. 唯一职责

本 Skill 只处理：用户不知道某个词、分类、缩写、机制名称或专业表达在当前语境中是什么意思，并因此难以理解视频主线。

路由边界：

- 不知道“这个词是什么” → 本 Skill；
- 知道词义但不知道数字尺度 → `abstract_to_intuitive`；
- 知道句意但怀疑准确性 → `claim_verification`；
- 只是好奇更多背景、普通常识词或无关实体 → 不触发。

本 Skill 不是生僻词收集器。没有真正理解损失时，空结果优于强行出卡。

## 2. 输入

读取 Harness 的完整 `SkillRunInput`，重点使用：

- `candidate.sourceText/startMs/endMs/segmentIds`；
- `candidate.contextBefore/contextAfter`；
- 此路由不读取 `candidate.ocrText/visualContext`；
- `routeDecision`。

按完整 ASR 语义句判断，至少结合前后文，检查作者是否在后文立即解释；不得使用 OCR 或画面作为证据。

## 3. 候选范围

允许：

- 专业术语：胃肠功能紊乱、胰岛素抵抗；
- 分类或标准：2A类致癌物、一级响应；
- 缩写或机构：IARC、WHO；
- 行业表达：做空、向上管理、去杠杆；
- 历史制度：荫封、察举制；
- 理解后文必需的机制或前置概念。

严格排除：

- 纯数字尺度；
- 对结论真假的怀疑；
- 作者已经解释清楚的词；
- 与主线无关的人名、地名和机构；
- ASR 无法可靠还原的词；
- 需要同时展开多个概念才说得清的内容；
- 仅仅适合画图、但不存在词义断层的内容。

## 4. 五项硬门槛

候选必须全部通过：

1. 目标普通用户可能不理解；
2. 作者在当前解释闭环内没有讲清；
3. 不理解会妨碍当前结论或后续主线；
4. 当前语境中的词义可确定；
5. 能用一句短答准确补懂。

若定义依赖未提供的专业来源，或在医学、法律、金融语境中存在实质歧义：

- 不得凭常识补写确定结论；
- 设置 `definition_status = needs_verification`；
- 默认 `display_mode = list_only`，必要时直接不触发。

## 5. 句内 Top1

同一个完整语义句最多保留一个概念。为每个候选分别打分：

- 主线理解必要性：0～35；
- 误解风险：0～25；
- 用户陌生度：0～20；
- 后续依赖程度：0～10；
- 单次解释收益：0～10。

`total_score >= 70` 才可保留。分数接近时依次选择：更影响主线、更容易误解、后文依赖更多、解释更短准确者。

其他候选保留在 `candidates` 供 Trace 查看，但不得连续弹出。整条视频中按标准词形去重；首次出现不重要、后文才成为核心时，可在后文触发。

## 6. 定义与问答

`source_span` 必须来自原文连续片段，不能由模型改写。

问题：

- 只问一个概念；
- 像普通用户自然会问；
- 建议不超过 18 个汉字；
- 不混入真假判断或数字尺度。

一句话回答：

- 先给当前语境中的核心意思；
- 必要时指出一个最常见误解；
- 不扩展第二个知识点；
- 不把不确定内容写成事实；
- 建议不超过 45 个汉字。

## 7. 完整卡片合同

保留当前产品决策：知识断层 Skill 必须输出完整卡片生图 Prompt，由万相 `wan2.7-image-pro` 生成含少量中文文字的完整图片，服务端裁切为 `310×180`；不得改成只生成贴纸再由代码排字。

固定结构：

- 顶部：一个问题；
- 中部：一个主贴纸 + 一个主回答；
- 底部：可选极短说明；
- 关键内容位于 `2K + 16:9` 生成图的中心安全区，适配最终 `310×180` CSS 展示尺寸；
- 不得出现第二个贴纸、第二个回答块、栏目名、来源角标、水印或无关文字。

生成前必须完成 `visual_semantic_plan`：

```text
selected_term
→ core_definition
→ user_misconception
→ visual_type
→ sticker_subject
→ must_express
→ must_show
→ must_not_show
→ image_prompt
```

贴纸必须同时匹配：概念主体、核心状态/关系、主回答含义。只画相关主体但状态相反，必须判为不合格。

视觉类型只从以下选择：

- `subject_state`
- `relationship`
- `classification_label`
- `process_action`
- `identity_system`
- `entity_identity`

`image_prompt` 必须逐字包含问题与回答，并明确主贴纸状态、`must_show`、`must_not_show`、少量中文、中心安全区和最终 310×180 适配要求。

统一视觉合同（必须逐项写入 `image_prompt`）：

- 背景必须是纯黑或近黑色哑光底（`#0B0B0B`～`#121212`）并铺满整张图片；图片内部不得绘制外层卡片边框、圆角线框或四周描边。圆角、描边和裁切由 H5 容器提供；禁止深蓝、深紫、渐变、发光底和场景背景。
- 顶部固定为问答区：问题用大号粗体白字，答案在其下用较小浅灰字；必须逐字准确，不得改写或添加栏目名。
- 中下部只使用一个直接表达概念主体和核心状态/关系的主贴图，不得用第二个贴图凑画面。
- 主贴图必须是参考图式的科普贴纸：简洁扁平 2D 造型，内部用干净深色粗线，外缘有明显粗白色模切描边，高饱和但不刺眼，仅保留轻微 2.5D 体积和小阴影，人物表情简单亲和。
- 禁止写实照片、3D 玩具/黏土渲染、日漫场景、水彩、复杂背景、额外人物、无关装饰和额外文字。
- 生成图内禁止出现关闭叉号、播放器按钮、手机外框或其他 UI 控件。

## 8. 唯一输出 Schema

只输出 JSON，不要 Markdown，不要额外解释。

```json
{
  "video_id": "video_001",
  "sentence_id": "sentence_017",
  "source_text": "IARC将高温饮品列为2A类致癌物",
  "source_span": "2A类致癌物",
  "start_ms": 31100,
  "end_ms": 34700,
  "candidate_count": 2,
  "candidates": [
    {
      "term": "IARC",
      "type": "abbreviation_entity",
      "total_score": 39
    },
    {
      "term": "2A类致癌物",
      "type": "classification_standard",
      "total_score": 95
    }
  ],
  "selected_term": "2A类致癌物",
  "selected_score": 95,
  "total_score": 95,
  "selection_reason": "承载核心结论且误解风险高",
  "definition_status": "stable",
  "video_already_explained": false,
  "should_trigger": true,
  "display_mode": "auto_prompt",
  "trigger_at_ms": 35200,
  "prompt_title": "2A类致癌物是什么意思？",
  "prompt_subtitle": "一句话补懂",
  "one_line_answer": "这是致癌证据分类，不等于一次接触就必然致癌。",
  "explainer_card": {
    "top_question": "2A类致癌物是什么意思？",
    "main_answer": "这是致癌证据分类，不代表必然致癌。",
    "optional_bottom_note": "重点是证据等级，不是个人结果预测。",
    "visual_semantic_plan": {
      "core_definition": "致癌证据分类",
      "user_misconception": "误以为接触一次就一定致癌",
      "visual_type": "classification_label",
      "sticker_subject": "2A等级标签牌",
      "must_express": "证据分类而非必然结果",
      "must_show": ["2A等级标签", "证据分类含义"],
      "must_not_show": ["必然致癌", "恐怖化病变"]
    },
    "main_sticker": "一块清晰的2A等级标签牌，配合证据分类符号，不表现确定疾病结果",
    "image_prompt": "完整卡片生图Prompt"
  }
}
```

无合格结果时：

```json
{
  "video_id": "video_001",
  "source_text": "原文",
  "source_span": "",
  "selected_term": "",
  "total_score": 0,
  "should_trigger": false,
  "display_mode": "discard",
  "selection_reason": "没有满足五项硬门槛的知识断层"
}
```

## 9. 必须通过的回归

1. `胃肠功能紊乱` 未解释且影响结论 → 保留，主体状态型卡片。
2. `2A类致癌物` 与 `IARC` 同句 → 选择更影响主线的 Top1。
3. `65℃有多烫` → 转 `abstract_to_intuitive`，本 Skill 不输出。
4. `喝一次就一定致癌吗` → 转 `claim_verification`，本 Skill 不输出。
5. 作者下一句已解释术语 → 抑制。
6. 只出现无关机构名 → 抑制。
7. 主贴纸与回答语义相反 → 不得生成合格结果。
8. 同句多个候选 → 只保留一个，其他进入 Trace。

## 10. 最终执行顺序

```text
读取完整语义句与上下文
→ 提取原文术语候选
→ 应用五项硬门槛
→ 句内独立评分并选择Top1
→ 生成克制的一句话定义
→ 建立视觉语义计划
→ 生成完整卡片Prompt
→ 输出唯一JSON结构
```
