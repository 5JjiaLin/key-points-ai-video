---
name: chain1-abstract-to-intuitive
description: 识别科普视频中尚未被作者讲直观的明确数字或数量级，生成现实尺度解释、完整310×180卡片生图Prompt与时间轴触发结果。用于“不知道这个数字到底多大、多快、多热、多久或多危险”；不处理名词释义和说法真假。
metadata:
  version: "16"
  mode: production
---

# 抽象数据直观化 Skill v16

## 1. 唯一职责

本 Skill 只处理：用户理解数字字面意思，但缺少现实尺度感。

必须同时满足：

1. 原文存在明确数字、数量级、比例、概率、倍数或阈值；
2. 数字绑定了单位或明确数量关系；
3. 普通用户仅凭原表达难以形成现实感受；
4. 作者尚未通过口播、OCR、画面、现实参照或前文解释完成直观化；
5. 能用一个核心数据在 3～5 秒内讲清。

不属于本 Skill：

- 不知道术语含义 → `knowledge_gap`；
- 知道句意但怀疑准确性 → `claim_verification`；
- 普通生活数字、纯机制、主题总结、行动建议；
- 作者已经解释清楚的数字。

空结果是正确结果，不得为了出卡而制造候选。

## 2. 输入

读取 Harness 提供的完整 `SkillRunInput`，重点使用：

- `candidate.sourceText/startMs/endMs/segmentIds`；
- `candidate.contextBefore/contextAfter`；
- `candidate.ocrText`；
- `candidate.visualContext`，包括画面描述、OCR、模拟/图表/尺度信息；
- `routeDecision`。

判断必须覆盖完整解释闭环，不得只看数字所在单句。视觉证据不足时，不得自动触发。

## 3. 原子候选与解释簇

### 3.1 原子候选

`source_span` 必须：

- 是 `candidate.sourceText` 中逐字连续片段；
- 只包含一个核心数据；
- 不拼接后文解释、参照或模型总结；
- `span_verbatim = true`，否则作废。

正确：`65℃`、`800伏`、`超过3000万亿元`。

错误：`3000万亿资产平分中国人后能铺满网球场`。

### 3.2 数据角色

先为解释闭环中的数字标注角色：

- `source_data`
- `author_translation`
- `concrete_reference`
- `comparison_baseline`
- `change_endpoint`
- `real_world_outcome`
- `background_context`
- `unresolved_candidate`

只有 `unresolved_candidate` 能进入 `selected_candidates`。

### 3.3 数据解释簇

按“实体 + 指标 + 时间范围 + 语义目标”聚合。同一事实的原始值、换算值、平均值、比较值、后果和画面参照属于同一簇；一簇最多保留一个候选。

追踪“它、这个数字、这些钱、这相当于、换算下来、放在现实里”等跨句指代，直到当前知识点解释结束。

## 4. 解释终点判定

为每个簇输出：

- `full_resolution`：已落到目标用户熟悉且可感知的时间、空间、数量、体感、现实结果或有效画面模拟；整个簇抑制。
- `partial_resolution`：作者做了换算或类比，但终点仍抽象；只评估最后一个未解决原子节点。
- `no_resolution`：作者没有给出有效尺度解释；评估原始数据。

重要修正：

- 美元换成人民币、公里换成更大公里数等只属于“受众本地化/单位换算”，不能自动判为 `full_resolution`；必须继续判断终点是否真的可感知。
- GDP、天文距离、巨大货币总量等参照本身可能仍抽象。
- “从 A 变到 B 并出现明确现实后果”默认是变化事件，不是尺度候选。
- 作者用于解释前一个数字的数字不能反过来成为新候选。

## 5. 多模态抑制

以下任一证据与当前数据语义对齐时，优先抑制：

- 真实物体模拟、堆叠或数量动画；
- 熟悉物体容量/长度/高度对比；
- 清晰刻度、区间、概率人数图；
- 口播与画面共同形成现实参照；
- 引用了前文已经完成直观化的对象。

无关 B-roll、装饰图、只出现数字文字，不算直观化。

## 6. 安全与事实边界

本 Skill 只能解释尺度，不能凭单一数字推导伤害、医学结论或确定后果。

例如：

- `800伏` 可以解释电压尺度，但不能直接等同固定痛感或伤害；
- `65℃` 可以给出温度区间参照，但新增健康风险结论必须有独立核验。

涉及健康、安全、金融或跨领域类比时：

```json
{
  "requires_claim_verification": true,
  "reason": "该表达包含超出尺度解释的事实或安全判断"
}
```

在核验完成前，卡片答案只写尺度，不写未经证实的后果。

## 7. 评分与展示

五项各按 `0.0～1.0` 评分：数量级陌生度、现实尺度缺失、主线重要性、自然好奇度、视觉化收益。仅在前述硬门槛通过后计算平均值 `abstract_data_score`。

- `>= 0.76` → `auto_prompt`
- `0.60～0.759` → `list_only`
- `< 0.60` → 抑制

安全敏感内容自动提示门槛提高到 `0.82`。

## 8. 完整卡片合同

保留当前产品决策：Skill 输出完整卡片生图 Prompt，万相 `wan2.7-image-pro` 以 2K 的 `2560×1440` 生成后由服务端保存为 `930×540` 的 3 倍屏资源，H5 仍以 `310×180` CSS px 展示。不得改成只生成贴纸、再由代码填文字。
卡片必须：
- 以 `310×180` 为最终阅读尺寸，关键内容置于中心安全区；
- 顶部问题区位置固定：左上方只显示逐字准确的大号粗体白色问题标题，不在标题下另写答案；
- 主体只解释一个核心数据，固定使用 4 个横向均匀排列的比较节点；节点贴图与文案必须根据当前视频内容生成，不得照搬温度示例；
- 根据数据选择刻度分档、并列参照、尺度阶梯或单核心参照；
- 每个节点必须把数字翻译成普通用户熟悉的体感、动作或现实结果，不能只把原数字改画成刻度；
- 当前关键节点必须给出用户能立即采用的短结论，例如“已经烫口”“需小口慢饮”，不能只写“数值更高”“超过体温”；
- 图片必须无品牌、无水印，问题建议不超过 15 个汉字；
- `visualization.image_prompt` 必须是可直接交给万相 `wan2.7-image-pro` 的完整描述，不得为空。

生成 Prompt 前先完成直观化映射：

```text
核心数字
→ 用户缺少的现实感受
→ 4个由熟悉到目标值的参照节点
→ 每个节点的可见状态
→ 目标节点的一句话体感或动作结论
```

温度示例不是只写 `37℃ → 50℃ → 65℃ → 80℃`，而要同时落到：

```text
37℃ 接近体温 / 感觉温热 / 装有温水的透明水杯
50℃ 明显偏热 / 入口较烫 / 冒少量热气的茶杯
65℃ 已经很烫 / 需小口慢饮 / 冒明显热气的水杯和轻微烫嘴表情
100℃ 沸水温度 / 不能直接喝 / 正在沸腾并冒大量热气的水壶
```

统一使用 `abstract_sticker_compare_v1` 视觉合同（必须逐项写入 `image_prompt`）：

- 背景为深黑或炭黑纯色底（`#0B0B0B`～`#121212`）并铺满整张图片；不得绘制外层卡片边框、圆角线框或四周描边。圆角、描边和裁切由 H5 容器提供。
- 顶部问题区位置不变：左上方仅显示大号粗体白色问题标题；`qa_region.answer` 继续作为结构化答案，但不在图内标题下单独排版。
- 主体固定为 4 个横向均匀排列的比较组，每组从上到下只有“数值或量级标签 + 一个科普贴图 + 核心判断 + 极短说明”。四项内容由当前 `intuitive_mapping.nodes` 动态提供。
- 4 个贴图必须属于同一套视觉家族：简洁 2D 科普贴纸插画，轻微 2.5D 体积感，粗白色模切外轮廓，细深灰内描边，圆润几何造型，柔和左上高光，轻微统一阴影，中等偏高饱和度，无写实纹理，统一使用正视角或轻微三分之四视角。
- 四项使用从蓝、黄、橙到红的递进色彩关系；仅使用珊瑚红圆角描边框突出当前目标项。
- 禁止复杂背景、真实照片、摄影质感、医学器官、人物场景、海报式排版、来源说明、脚注、表格、多层面板、复杂流程、炫光、粒子效果、不同画风混用和额外无关物件。除标题、4 个数值或量级标签、4 个核心判断和 4 条极短说明外，不添加任何其他内容。
- 生成图内禁止出现关闭叉号、播放器按钮、手机外框或其他 UI 控件。

出图前后必须执行缩略图自检：缩到 `310×180` 后，用户应能在 3 秒内说出目标数字“是什么感觉”或“意味着什么动作”。若只能复述数字大小，必须重做视觉映射和 Prompt。

## 9. 唯一输出 Schema

只输出 JSON，不要 Markdown，不要解释文字。

```json
{
  "video_id": "video_001",
  "selected_candidates": [
    {
      "candidate_id": "ad_001",
      "source_span": "800伏",
      "span_verbatim": true,
      "candidate_role": "unresolved_candidate",
      "data_cluster_id": "cluster_001",
      "data_type": "voltage",
      "value": 800,
      "unit": "V",
      "missing_scale": "用户不知道800伏处于什么电压尺度",
      "intuitive_mapping": {
        "user_missing_experience": "用户不知道800伏相对日常用电处于什么尺度",
        "target_takeaway": "远高于日常家用电压",
        "nodes": [
          {
            "value_label": "12伏",
            "familiar_reference": "小型低压设备",
            "visible_state": "低压电池组",
            "experience_or_action": "常见低压"
          },
          {
            "value_label": "220伏",
            "familiar_reference": "家庭插座",
            "visible_state": "普通墙面插座",
            "experience_or_action": "日常家用电压"
          },
          {
            "value_label": "380伏",
            "familiar_reference": "工业配电",
            "visible_state": "工业配电箱",
            "experience_or_action": "高于家用电压"
          },
          {
            "value_label": "800伏",
            "familiar_reference": "高压警示设备",
            "visible_state": "带高压警示的设备外壳",
            "experience_or_action": "远高于家用电压"
          }
        ]
      },
      "natural_question": "800伏是什么概念？",
      "author_concretization_check": {
        "resolution_status": "no_resolution",
        "unresolved_endpoint": "800伏",
        "already_concretized": false,
        "evidence": []
      },
      "abstract_data_score": 0.86,
      "trigger_level": "auto_prompt",
      "trigger_at_ms": 14500,
      "safety_boundary": {
        "requires_claim_verification": true,
        "reason": "电压不能单独等同固定伤害"
      },
      "visualization": {
        "qa_region": {
          "question": "800伏是什么概念？",
          "answer": "远高于日常家用电压"
        },
        "visual_region": {
          "layout_type": "sticker_compare",
          "node_count": 4,
          "highlight_node": 4,
          "nodes": []
        },
        "image_prompt": "完整卡片生图Prompt"
      }
    }
  ],
  "suppressed_candidates": [
    {
      "source_span": "55万亿元",
      "resolution_status": "full_resolution",
      "suppress_reason": "作者已用现实参照完成直观化",
      "evidence": ["原文或画面证据"]
    }
  ]
}
```

无合格候选时：

```json
{"video_id":"video_001","selected_candidates":[],"suppressed_candidates":[]}
```

## 10. 必须通过的回归

1. `100万在现实中模拟出来` → `full_resolution`，抑制。
2. `55万亿元，能垒成东方明珠高度` → 同簇抑制。
3. `10万亿美元≈100万亿人民币` → 仅换算，不自动解决尺度感。
4. `1光年≈9.46万亿公里` → `partial_resolution`，只评估终点。
5. `子弹蚁咬一下≈800伏电击` → 提取尺度候选，同时要求说法核验。
6. `从300亿美元缩水到几十亿并破产` → 变化事件，默认抑制。
7. 作者用网球场、人均金额解释总量 → 解释证据不得变成新候选。
8. 只输出数字、色点和刻度，没有熟悉参照与体感/动作 → 结构不合格，不得生成卡片。
9. 全部数字已解释 → `selected_candidates = []`。

## 11. 最终执行顺序

```text
读取完整多模态上下文
→ 截取原子数字
→ 标注角色并聚类
→ 等待解释闭环结束
→ 判断解释终点与视觉证据
→ 通过硬门槛后评分
→ 生成尺度安全的问题、答案和完整卡片Prompt
→ 输出 selected / suppressed JSON
```
