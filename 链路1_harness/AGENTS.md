# AGENTS.md

> 本文件是「划重点」当前 Demo 开发的最高优先级项目说明。  
> Codex 在修改代码前必须先完整阅读本文件，再检查仓库现有代码、`README`、`package.json`、路由、组件和样式约定。  
> 若本文件与旧原型、旧会议稿或历史代码冲突，以本文件描述的**当前产品决策**为准；若与用户最新明确指令冲突，以用户最新指令为准。

---

## 1. 项目名称

**划重点**

一个面向科普视频观看场景的 AI 内容理解与知识导航产品。

当前产品不只是“总结视频”，而是同时解决两个问题：

1. 用户正在看视频，但遇到没讲清、难判断或不直观的内容；
2. 用户想知道整条视频正在讲什么、讲到哪里、答案是什么，并能稍后找回和记录。

因此产品由两条同时运行、职责不同的核心链路组成：

- **链路 1：内容理解补丁**
- **链路 2：视频知识导航**

一句话区分：

> 链路 2 负责告诉用户“视频正在讲什么”；链路 1 负责帮助用户“真正看懂”。

### 1.1 产品载体

当前产品形态明确为：

> **移动端优先的 H5 Web 应用，不是原生 App，也不是小程序。**

开发时必须按真实手机浏览器中的网页处理，而不是只在桌面端套一个手机外框做静态展示。

当前适配目标：

- 手机竖屏 H5；
- iOS Safari；
- Android Chrome 及常见 Chromium 内核浏览器；
- 桌面浏览器仅用于开发、调试和演示；
- 暂不接入原生 App API；
- 暂不依赖小程序专属能力；
- 暂不要求桌面端独立信息架构。

所有交互都应优先考虑：

- 触摸操作；
- 手机浏览器地址栏伸缩；
- 安全区域；
- H5 视频播放限制；
- 页面刷新后的基础状态恢复；
- 弱网和资源加载失败；
- 浏览器返回行为。

---

## 2. 当前开发阶段

当前已经有：

- 基础页面；
- 视频播放页面；
- 部分页面视觉原型；
- 链路 2 的 Skill Harness 设计；
- 链路 1 的 Skill 正在持续打磨；
- 轻提示、展开卡片、本视频知识点抽屉等 UI 方案。

当前开发目标不是一次性完成最终产品，而是先交付一个可操作的 **基础链路 Demo**：

1. 视频可上传或选择示例视频；
2. 视频能正常播放；
3. 两条链路能根据预设时间轴运行；
4. 链路 1 能在指定时间点显示轻提示并展开详情；
5. 链路 2 能常驻显示当前知识点、进度和答案；
6. “本视频知识点”图标能打开非全屏底部抽屉；
7. 抽屉包含“知识点 / 全文 / 我的笔记”三个栏目；
8. 后续可无痛替换为真实 Skill/Harness 输出；
9. 后续可继续替换精细 UI、动画和贴图资源。

### 当前阶段优先级

```text
可运行链路
> 状态正确
> 数据结构稳定
> 组件可替换
> 精细视觉
> 动画细节
> 真实模型接入
```

不要为了还未最终确定的贴图风格或动效，阻塞基础链路开发。

---

## 3. 当前 Demo 的非目标

当前阶段不要主动扩大范围。

暂不要求：

- 完整生产级视频上传和转码服务；
- 实时 ASR、OCR、视觉理解；
- 在前端直接调用大模型；
- 最终版 Skill 提示词实现；
- 生产级事实核查搜索；
- 用户账号、关注、点赞、评论等完整社交功能；
- 笔记云同步；
- 桌面端和平板端的独立产品适配；
- 原生 iOS / Android App；
- 微信小程序或其他平台专属版本；
- 最终视觉动效；
- 真实抖音接口或真实平台数据；
- 完整后台管理系统。

这些能力可以预留接口，但 Demo 应优先使用本地 Mock 数据跑通体验。

---

# 4. 产品的两个主要链路

---

## 4.1 链路 1：内容理解补丁

### 4.1.1 解决的需求

链路 1 不总结视频主干，而是识别视频中可能影响理解的具体表达，补充原视频没有充分解决的内容。

只处理三类需求：

#### A. 把抽象数字变直观

典型原文：

- “65℃以上的热水”
- “800 伏”
- “1000 亿倍太阳质量”
- “0.01 秒”

用户问题：

- 65℃到底有多烫？
- 800 伏是什么概念？
- 这个数字到底有多大、多久、多快、多危险？

输出重点：

- 熟悉参照；
- 区间、刻度或分档；
- 贴图对比；
- 现实场景；
- 可能结果。

示例：

```text
问题：65℃有多烫？
辅助文案：和日常热饮对比一下
详情：37℃接近体温 → 50℃明显偏热 → 65℃已经烫口
```

#### B. 验证视频说法

典型原文：

- “冰水就是不健康的”
- “这种吃法一定减肥”
- “这是历史上最彻底的一次改革”

用户问题：

- 这句话是真的吗？
- 说法是不是过于绝对？
- 成立需要哪些前提？

输出不能粗暴否定作者，也不能只给“真 / 假”。

优先采用：

- 基本准确；
- 有条件成立；
- 表达过于绝对；
- 存在争议；
- 证据不足。

示例：

```text
问题：冰水就是不健康的吗？
辅助文案：换个角度看
详情：需要结合人群、饮用量、饮用速度和身体状态判断。
```

#### C. 补上知识断层

典型原文：

- “引发胃肠功能紊乱”
- “2A 类致癌物”
- “向上管理”
- “板块俯冲”

用户问题：

- 功能紊乱是什么？
- 这个词是什么意思？
- 博主默认我知道，但我其实不知道。

输出重点：

- 一句话定义；
- 与当前视频的关系；
- 简单类比；
- 容易误解的地方；
- 贴图解释。

示例：

```text
问题：功能紊乱是什么？
辅助文案：1句话补懂
详情：胃肠运行节奏暂时失调，会不舒服，但不等于器官已经损伤。
```

---

### 4.1.2 处理方式

上传视频后，链路 1 的 Skill 或未来 Harness 预先生成所有理解补丁，包含：

- 类型；
- 触发时间；
- 原文；
- 问题；
- 轻提示辅助文案；
- 展开详情；
- 贴图资源或贴图生成描述；
- 优先级；
- 是否自动轻提示；
- 是否仅进入知识点列表。

播放时不实时生成答案。

```text
上传视频
→ 解析字幕 / OCR / 画面 / 上下文
→ 识别三类理解障碍
→ 生成轻提示与展开详情
→ 绑定视频时间轴
→ 播放到对应时间后触发
```

当前 Demo 可直接读取本地 JSON Fixture，不等待真实 Skill 完成。

---

### 4.1.3 播放交互

```text
视频播放到触发位置
→ 视频下方出现轻提示
→ 用户点击 / 用户忽略
```

#### 用户点击

```text
点击轻提示
→ 视频暂停
→ 在视频下方展开详情卡
→ 用户查看图解 / 核验 / 解释
→ 用户关闭详情
→ 详情收起
→ 视频从原知识点前 1～2 秒继续播放
→ 该补丁标记为已查看
```

#### 用户忽略

```text
完整轻提示显示约 4 秒
→ 缩成小标签约 6 秒
→ 页面上淡出
→ 不删除
→ 自动存入“本视频知识点”
→ 标记为未查看
→ 知识点图标增加未读角标
```

以上时间必须做成可配置常量，而不是散落在组件中的魔法数字。

推荐默认值：

```ts
const SUPPLEMENT_FULL_PROMPT_MS = 4000;
const SUPPLEMENT_COMPACT_PROMPT_MS = 6000;
const SUPPLEMENT_REOPEN_BADGE_MS = 2500;
const SUPPLEMENT_COOLDOWN_MS = 8000;
```

---

### 4.1.4 轻提示位置

硬规则：

> 链路 1 的轻提示和详情不得遮挡视频画面。

优先放置：

1. 视频下方黑色信息区；
2. “全屏观看”按钮下方、作者信息上方；
3. 必要时覆盖作者名称、标签、简介等下半部分；
4. 不覆盖右侧视频操作栏；
5. 不覆盖字幕；
6. 不覆盖视频主体。

展开详情可以覆盖下方作者信息和标签，但视频必须保持可见。

---

### 4.1.5 链路 1 的列表留存

轻提示是否被点击，都要进入“本视频知识点”列表：

- 未点击：`unread`
- 已点击：`viewed`
- 用户记下：`saved`
- 用户选择不感兴趣：`dismissed`

关闭详情只代表关闭当前卡片，不代表删除知识点。

---

## 4.2 链路 2：视频知识导航

### 4.2.1 解决的需求

链路 2 解决：

- 这条视频讲了哪些知识点；
- 当前正在讲哪个问题；
- 这个知识点还有多久讲完；
- 当前知识点的结论是什么；
- 怎样快速跳回对应片段；
- 怎样一次查看整条视频的知识结构。

它不是链路 1 的“解释补充”，而是原视频主干知识结构的重构。

---

### 4.2.2 当前 Harness 结构

链路 2 由三个 Skill 组成 Harness：

```text
Skill 1：识别视频知识点及时间段
→ Skill 2：把知识点变成有趣、自然的问题
→ Skill 3：根据问题生成对应的简短答案
→ Harness 审核与稳定输出
```

每个知识点至少输出：

```ts
interface VideoKnowledgePoint {
  id: string;
  title: string;
  factualStatement: string;
  question: string;
  answer: string;
  startTime: number;
  endTime: number;
  taskType?: string;
  chapterId?: string;
  order: number;
}
```

时间点规则：

- `startTime` 是该知识点开始讲解的位置；
- `endTime` 是该知识点讲解结束的位置；
- 不能只定位关键词出现位置；
- 点击回看时，应从知识点讲解开头开始。

---

### 4.2.3 常驻窗口

视频开始播放时，链路 2 窗口立即出现，并一直存在。

无论当前是否出现链路 1，链路 2 的状态都要继续由时间轴维护。

默认内容：

```text
当前知识点问题
+ 正在讲解中
+ 剩余时间
+ 动态进度条
```

例如：

```text
喝冰水真的伤胃吗？
正在讲解中 · 还有 18 秒
[████████░░░░░░]
```

状态机：

```text
知识点尚未开始
→ 显示“接下来会讲” + 问题

知识点开始
→ 显示问题
→ 状态为“正在讲解中”
→ 进度条随 currentTime 推进
→ 显示剩余时间

知识点结束
→ “正在讲解中”切换为答案
→ 答案停留约 3～4 秒

答案展示结束
→ 切换到下一个知识点的问题
```

答案停留时间必须可配置：

```ts
const KNOWLEDGE_ANSWER_HOLD_MS = 3500;
```

---

### 4.2.4 点击常驻窗口

点击链路 2 常驻窗口：

```text
视频暂停
→ 打开“本视频知识点”底部抽屉
→ 默认进入“知识点”栏目
```

不是直接打开当前知识点详情，也不是打开通用 AI 问答页。

---

# 5. 两条链路如何同时存在

两条链路必须同时运行，但不要争夺页面。

## 5.1 职责不可混淆

| 项目 | 链路 1 | 链路 2 |
|---|---|---|
| 核心作用 | 辅助用户看懂 | 展示视频知识主干 |
| 数据来源 | 视频中的理解障碍 | 视频的主干知识点 |
| 页面形态 | 按时间触发的轻提示 | 全程常驻窗口 |
| 点击后 | 当前补充详情 | 全部知识点列表 |
| 忽略后 | 淡出并进入列表 | 不消失 |
| 典型内容 | 65℃有多烫、功能紊乱是什么、说法是否绝对 | 当前视频问题、讲解进度、问题答案 |

---

## 5.2 页面冲突优先级

默认：

```text
链路 2 常驻窗口显示
→ 到达链路 1 触发点
→ 链路 1 轻提示临时占用主提示区域
→ 链路 2 窗口折叠为更小状态或临时隐藏
→ 链路 1 消失 / 关闭
→ 链路 2 恢复到当前播放时间对应状态
```

要求：

- 链路 1 不得导致链路 2 的时间状态丢失；
- 链路 1 展开详情时视频暂停；
- 视频暂停期间，链路 2 进度停止；
- 用户关闭链路 1 后，链路 2 应按最新 `currentTime` 恢复；
- 不同时显示两张大型卡；
- 同一时间只允许一个主操作焦点。

推荐页面优先级：

```text
详情抽屉 / 详情卡
> 链路 1 轻提示
> 链路 2 常驻窗口
> 作者与标签信息
```

---

# 6. “本视频知识点”功能

右上角 AI 图标旁增加“本视频知识点”图标。

建议图标：

- 列表；
- 笔记本；
- 三个知识点圆点；
- 小卡片集合。

角标表示：

> 当前视频未查看的理解补丁数量。

不要用总知识点数量作为角标，避免数字长期不归零。

点击图标：

```text
视频暂停
→ 底部抽屉打开
→ 不全屏
→ 上方保留一部分视频
```

底部抽屉必须：

- 白色或当前 UI 体系对应的浅色面板；
- 顶部圆角；
- 有拖拽把手；
- 约覆盖屏幕下方 65%～70%；
- 可以下滑关闭；
- 不把视频完整遮住。

---

## 6.1 抽屉三个栏目

```text
知识点 | 全文 | 我的笔记
```

不要设置“详情 / 问 AI”，因为右上角已有独立 AI 入口。

---

## 6.2 知识点栏目

默认选中。

显示：

```text
本视频知识
5 个知识点 · 2 个未查看
```

列表需要同时容纳：

1. 链路 2 的视频主干知识点；
2. 链路 1 的理解补丁。

必须通过类型标签区分：

- `知识点`：视频主干；
- `求真`：验证说法；
- `对比`：数字直观化；
- `解释`：知识断层。

示例：

```text
求真 00:18
冰水就是不健康的？
需要结合人群、饮用量和饮用方式来看

对比 00:32
65℃有多烫？
用常见热饮体感做参照

解释 01:03
功能紊乱是什么？
不等于胃被伤坏，而是运行节奏暂时失调
```

每行支持：

- 展开；
- 回到原片；
- 记下；
- 未读 / 已读状态。

“回到原片”：

```text
关闭抽屉
→ currentTime 跳到知识点 startTime
→ 从该处播放
```

---

## 6.3 全文栏目

解决“视频转文字”和定位需求。

提供两个子模式：

```text
原始字幕 | 整理文本
```

### 原始字幕

- 保留时间戳；
- 按视频原话展示；
- 点击任意段落跳转视频；
- 当前播放段落高亮；
- 支持搜索；
- 支持复制；
- 支持选中文字后“解释 / 求真 / 加入笔记”。

### 整理文本

- 清理口头语和重复；
- 按知识点或章节分段；
- 不改变原意；
- 每段仍保留回到视频的时间入口。

当前 Demo 可以先实现：

- 原始字幕；
- 时间戳跳转；
- 当前段落高亮；
- 搜索框；
- “复制全文”。

“整理文本”可先使用 Mock 内容或标记为实验功能。

---

## 6.4 我的笔记栏目

解决：

- 记录知识点；
- 保存用户自己的理解；
- 记录疑问；
- 之后继续补充；
- 回到原片；
- 导出笔记。

笔记内容建议包含：

```ts
interface VideoNote {
  id: string;
  videoId: string;
  sourceItemId?: string;
  sourceType?: 'knowledge_point' | 'supplement' | 'transcript';
  timestamp?: number;
  title: string;
  aiSummary?: string;
  userText: string;
  status?: 'understood' | 'question' | 'review_later';
  createdAt: string;
  updatedAt: string;
}
```

页面显示：

- 视频标题和来源；
- 已保存知识点；
- AI 补充；
- 用户自己的笔记；
- 用户疑问；
- 原视频时间点。

当前 Demo 至少实现：

- “记下”后生成笔记卡；
- 编辑个人文字；
- 删除；
- 点击时间点回到视频；
- 本地持久化；
- 导出 / 分享按钮可以先做 UI 和模拟行为。

建议使用 `localStorage` 或现有项目的本地状态持久化方案。

---

# 7. AI 图标与知识点图标的分工

## AI 图标

用于：

- 围绕当前视频自由提问；
- 查看视频详情；
- 使用已有“详情 / 问 AI”结构。

## 本视频知识点图标

用于：

- 找回轻提示；
- 查看视频全部知识点；
- 查看全文；
- 记录和整理笔记。

禁止两个入口出现完全相同的页面。

---

# 8. 视频上传与解析状态

当前 Demo 可以有一个简化上传页或示例入口。

推荐流程：

```text
上传视频 / 选择示例视频
→ 显示解析中
→ 同时运行链路 1 和链路 2 数据生成
→ 完成后进入播放页
```

当前真实模型未接入时：

```text
上传成功
→ 根据文件名或 demo id 绑定本地 fixture
→ 模拟 1～2 秒解析过程
→ 进入播放页
```

必须通过 Adapter 隔离 Mock 与真实接口。

不要在 UI 组件中直接读取硬编码的 Demo 文案。

---

# 9. 推荐数据结构

```ts
type SupplementType =
  | 'abstract_to_intuitive'
  | 'claim_verification'
  | 'knowledge_gap';

type ItemReadState =
  | 'unread'
  | 'viewed'
  | 'saved'
  | 'dismissed';

interface VideoProject {
  id: string;
  title: string;
  creator: string;
  duration: number;
  videoUrl: string;
  coverUrl?: string;
  transcript: TranscriptSegment[];
  knowledgePoints: VideoKnowledgePoint[];
  supplements: UnderstandingSupplement[];
  chapters?: VideoChapter[];
}

interface UnderstandingSupplement {
  id: string;
  type: SupplementType;
  sourceText: string;
  startTime: number;
  endTime?: number;
  triggerTime: number;
  question: string;
  helperText: string;
  shortAnswer: string;
  detail: SupplementDetail;
  sticker?: StickerAsset;
  triggerLevel: 'auto_prompt' | 'list_only' | 'suppress';
  priority: number;
  readState: ItemReadState;
}

interface SupplementDetail {
  title: string;
  answer: string;
  sections?: Array<{
    title?: string;
    text?: string;
    visualType?: string;
    visualData?: unknown;
  }>;
  sourceNotes?: Array<{
    title: string;
    url?: string;
    description?: string;
  }>;
}

interface StickerAsset {
  kind:
    | 'temperature_scale'
    | 'object_comparison'
    | 'concept_diagram'
    | 'balance'
    | 'scenario_grid'
    | 'custom';
  imageUrl?: string;
  alt: string;
  config?: unknown;
}

interface VideoKnowledgePoint {
  id: string;
  title: string;
  factualStatement: string;
  question: string;
  answer: string;
  startTime: number;
  endTime: number;
  order: number;
  chapterId?: string;
}

interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

interface VideoChapter {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
}
```

---

# 10. 统一时间轴运行器

两条链路不应各自实现一套 `timeupdate` 逻辑。

需要一个统一 Timeline Engine：

```ts
interface TimelineSnapshot {
  currentTime: number;
  currentKnowledgePoint?: VideoKnowledgePoint;
  nextKnowledgePoint?: VideoKnowledgePoint;
  activeSupplement?: UnderstandingSupplement;
  pendingSupplements: UnderstandingSupplement[];
  knowledgeProgress: number;
  knowledgeRemainingSeconds: number;
}
```

职责：

- 根据 `video.currentTime` 找到当前知识点；
- 计算知识点进度；
- 检测链路 1 trigger；
- 避免同一补丁重复触发；
- 管理冷却时间；
- 视频跳转后重新计算状态；
- 暂停时停止倒计时；
- 关闭抽屉后恢复；
- 支持回看重新触发，但同一补丁最多自动重触发一次。

建议独立为：

```text
src/features/video-timeline/
```

不要把时间判断散落在多个 React 组件中。

---

# 11. 推荐页面和组件结构

具体文件名应优先遵循现有仓库结构。若仓库没有明确约定，可参考：

```text
src/
├─ app/
│  ├─ routes/
│  └─ providers/
├─ pages/
│  ├─ UploadPage/
│  └─ VideoPlayerPage/
├─ features/
│  ├─ video-player/
│  │  ├─ VideoPlayer.tsx
│  │  ├─ VideoControls.tsx
│  │  └─ useVideoController.ts
│  ├─ video-timeline/
│  │  ├─ timelineEngine.ts
│  │  ├─ useTimeline.ts
│  │  └─ timeline.types.ts
│  ├─ knowledge-navigation/
│  │  ├─ KnowledgeNowCard.tsx
│  │  ├─ KnowledgeProgress.tsx
│  │  └─ knowledgeNavigation.utils.ts
│  ├─ understanding-supplement/
│  │  ├─ SupplementLightPrompt.tsx
│  │  ├─ SupplementCompactPrompt.tsx
│  │  ├─ SupplementDetailCard.tsx
│  │  ├─ supplementRenderers/
│  │  └─ useSupplementPrompt.ts
│  ├─ video-knowledge-drawer/
│  │  ├─ VideoKnowledgeDrawer.tsx
│  │  ├─ KnowledgeTab.tsx
│  │  ├─ TranscriptTab.tsx
│  │  └─ NotesTab.tsx
│  └─ ai-entry/
├─ services/
│  ├─ adapters/
│  │  ├─ chain1SkillAdapter.ts
│  │  ├─ chain2HarnessAdapter.ts
│  │  └─ mockVideoAnalysisAdapter.ts
│  └─ videoAnalysisService.ts
├─ fixtures/
│  └─ ice-water-demo.ts
├─ stores/
│  └─ videoExperienceStore.ts
├─ types/
└─ styles/
```

---

# 12. Adapter 规则

真实 Skill / Harness 尚未最终稳定，所以必须隔离。

```ts
interface VideoAnalysisAdapter {
  analyzeVideo(input: AnalyzeVideoInput): Promise<VideoProject>;
}
```

至少提供：

```text
MockVideoAnalysisAdapter
Chain1SkillAdapter
Chain2HarnessAdapter
```

当前 Demo 默认使用 Mock Adapter。

未来接入时，只替换 Adapter，不改播放页和 UI 主逻辑。

---

# 13. 示例 Demo 数据

当前推荐用“喝冰水伤胃吗？”视频作为主要 Demo。

至少准备：

## 链路 1

```ts
[
  {
    id: 'supplement-claim-ice-water',
    type: 'claim_verification',
    sourceText: '冰水就是不健康的',
    triggerTime: 18,
    question: '冰水就是不健康的吗？',
    helperText: '换个角度看',
    shortAnswer: '需要结合人群、饮用量、饮用速度和身体状态判断。'
  },
  {
    id: 'supplement-temperature-65',
    type: 'abstract_to_intuitive',
    sourceText: '65℃以上的水',
    triggerTime: 32,
    question: '65℃有多烫？',
    helperText: '和日常热饮对比一下',
    shortAnswer: '已经明显烫口，不再只是温热。'
  },
  {
    id: 'supplement-functional-disorder',
    type: 'knowledge_gap',
    sourceText: '引发胃肠功能紊乱',
    triggerTime: 63,
    question: '功能紊乱是什么？',
    helperText: '1句话补懂',
    shortAnswer: '胃肠运行节奏暂时失调，会不舒服，但不等于器官已经损伤。'
  }
]
```

以上时间为 Demo 参考值。以实际视频时间轴为准，不要把示例值当成最终产品常量。

## 链路 2

至少准备 4～6 个连续知识点，每项包含：

- 问题；
- 答案；
- startTime；
- endTime。

例如：

```ts
[
  {
    question: '喝冰水真的伤胃吗？',
    answer: '多数健康人适量饮用冰水，通常不会造成长期胃损伤。',
    startTime: 10,
    endTime: 45
  },
  {
    question: '高温饮品为什么更值得注意？',
    answer: '长期反复饮用过烫饮品，可能持续刺激食管。',
    startTime: 45,
    endTime: 85
  },
  {
    question: '喝冰水为什么会短暂不舒服？',
    answer: '低温刺激可能让胃肠运动节奏暂时变化，引起短暂不适。',
    startTime: 85,
    endTime: 130
  }
]
```

---

# 14. 关键 UI 状态

必须支持以下状态，不要只做静态截图。

## 播放页

- 正常播放；
- 链路 2：下一个问题；
- 链路 2：正在讲解；
- 链路 2：答案展示；
- 链路 1：完整轻提示；
- 链路 1：缩小轻提示；
- 链路 1：详情展开；
- 知识点抽屉打开；
- AI 抽屉打开；
- 视频暂停；
- 视频跳转；
- 视频结束。

## 本视频知识点抽屉

- 知识点；
- 全文；
- 我的笔记；
- 未查看；
- 已查看；
- 无知识点；
- 无笔记；
- 搜索无结果。

---

# 15. 动画和过渡的当前要求

当前阶段只做基础动画，不追求最终效果。

建议：

- 轻提示进入：`translateY + opacity`，200～280ms；
- 完整提示缩小：高度、宽度和文字透明度过渡；
- 详情展开：下方区域高度展开；
- 底部抽屉：标准 bottom-sheet 上滑；
- 链路 2 问题切答案：内容淡出再淡入；
- 进度条：随视频时间连续更新，不做跳帧动画；
- 恢复链路 2：轻微淡入，不重新做强提示。

尊重系统“减少动态效果”设置。

所有动画时长集中管理，后续便于替换。

---

# 16. H5 与手机适配基准

本项目是**手机端 H5**。页面最终运行在移动浏览器中，而不是原生 App 容器。

## 16.1 视口基准

优先测试：

```text
360 × 800
375 × 812
390 × 844
393 × 852
412 × 915
430 × 932
```

要求：

- 页面宽度使用真实视口宽度；
- 不在手机端显示额外手机边框；
- 不使用固定 `390px` 作为业务页面宽度；
- 桌面调试时可用 `max-width: 430px` 居中模拟手机；
- 关键布局不能依赖某一个机型高度；
- 横屏可给出基础兼容，但不是当前主要体验。

推荐根容器：

```css
.app-shell {
  width: 100%;
  min-height: 100dvh;
  max-width: 430px;
  margin: 0 auto;
}
```

不能只使用 `100vh`。移动浏览器地址栏会让它时而诚实、时而像个会移动的天花板。

优先使用：

```css
min-height: 100dvh;
min-height: 100svh;
```

并准备兼容回退。

## 16.2 安全区域

顶部和底部交互必须考虑刘海、灵动岛和 Home Indicator：

```css
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);
```

底部抽屉、播放器控制区、笔记输入区不得贴住系统手势区域。

## 16.3 视频区域

H5 `<video>` 至少设置：

```html
<video
  playsinline
  webkit-playsinline
  preload="metadata"
  controlslist="nodownload noplaybackrate"
></video>
```

规则：

- 默认不要带声音自动播放；
- 需要自动播放时必须先静音，并准备失败回退；
- 用户手势后再尝试播放声音；
- 使用 `playsInline`，避免 iOS 强制进入系统全屏；
- 监听 `loadedmetadata`、`timeupdate`、`seeking`、`seeked`、`pause`、`play`、`ended`；
- 视频加载失败时提供重试和示例视频入口；
- 页面进入后台再回来时，要重新同步 `currentTime` 和时间轴状态；
- 不依赖浏览器原生控件完成主要产品交互。

## 16.4 触摸交互

- 所有主要按钮点击区域至少 44×44；
- 不依赖 hover 才显示操作；
- 底部抽屉支持点击关闭和下滑关闭；
- 横向滑动不能误触浏览器返回手势；
- 长按字幕操作需要提供普通点击入口作为替代；
- 防止连续点击造成抽屉、视频和提示状态重复切换；
- 滚动区域要明确，避免页面与抽屉同时滚动。

## 16.5 页面滚动

播放器页优先采用：

```text
固定页面框架
+ 视频区域
+ 视频下方交互区
+ 独立滚动的 Bottom Sheet
```

要求：

- 主播放页尽量不发生长页面滚动；
- 抽屉打开后锁定背景滚动；
- 抽屉内容自身滚动；
- 键盘弹出时笔记输入框保持可见；
- 关闭软键盘后恢复正确高度；
- 不因地址栏伸缩导致抽屉跳动。

## 16.6 浏览器返回

H5 需要处理：

```text
抽屉打开
→ 用户按浏览器返回
→ 先关闭抽屉
→ 再次返回才离开视频页
```

详情卡、AI 面板和知识点抽屉应接入同一套 Overlay History 规则，避免用户按一次返回直接退出整个视频页。

## 16.7 桌面展示

桌面浏览器只用于：

- Codex 开发；
- 调试；
- 演示；
- 自动化测试。

桌面展示可以居中显示最大宽度 430px 的 H5 页面，但不要把桌面外框、设备模型或阴影写进实际手机端布局。

---

# 17. 可访问性

至少满足：

- 所有图标按钮有 `aria-label`；
- 贴图有 `alt`；
- 不只靠颜色表示“求真 / 对比 / 解释”；
- 键盘可打开和关闭底部抽屉；
- `Esc` 关闭详情；
- 文字对比度足够；
- 点击区域至少 44×44；
- 视频暂停和播放状态可感知；
- 避免自动播放声音；
- 焦点状态不能只为桌面键盘服务，也要保证触屏用户获得明确反馈；
- 弹出软键盘后，输入区域不能被遮挡。

---

# 18. 工程规则

## 必须

- 优先复用现有组件和设计系统；
- TypeScript 严格模式；
- 业务状态与视觉组件分离；
- 时间轴逻辑单独测试；
- Mock 数据与 UI 解耦；
- 所有可调时长集中配置；
- 复杂状态使用明确枚举或状态机；
- 用户笔记本地持久化；
- 播放跳转和抽屉关闭行为可测试；
- 保持代码可替换性；
- 使用移动端真实视口和安全区域；
- 关键交互在 iOS Safari 与 Android Chrome 中验证；
- 处理浏览器返回、页面后台恢复和视频自动播放失败。

## 禁止

- 在组件中散落判断 `currentTime > 18` 之类硬编码；
- 在 UI 里直接调用 LLM；
- 把链路 1 和链路 2 合并成同一种卡；
- 轻提示遮挡视频；
- 点击链路 2 窗口直接进入通用问 AI；
- 关闭详情后删除知识点；
- 同时展示两个大型卡片；
- 为了 Demo 重写整个现有项目；
- 未经确认迁移技术栈；
- 使用伪造的外部医疗来源链接；
- 把 Demo 文案当作医疗建议；
- 把 H5 当成原生 App，调用不存在的系统能力；
- 依赖 hover 完成核心操作；
- 用固定屏幕高度或固定手机宽度写死布局；
- 在移动端实际页面中绘制手机设备外框。

---

# 19. 现有技术栈处理原则

Codex 必须先检查：

- `package.json`
- lockfile
- `src`
- 路由
- 状态管理
- CSS 方案
- 测试框架
- lint / format 配置

现有技术栈是第一优先级，不要随意迁移。

仅当仓库为空或没有可运行前端时，默认采用：

```text
React
TypeScript
Vite
React Router
CSS Modules 或现有 Tailwind
Vitest
Testing Library
原生 HTML5 Video API
移动端 H5 viewport 与 safe-area 适配
```

不要为了一个 Demo 引入大型状态机库或复杂后端。

如果当前已有 Zustand、Redux、XState 等，继续沿用。

---

# 20. 建议开发顺序

## Phase 0：仓库审查

1. 运行项目；
2. 找到现有视频页；
3. 找到现有 AI 抽屉；
4. 确认样式体系；
5. 列出准备修改的文件；
6. 不立即推翻现有结构。

## Phase 1：数据与时间轴

1. 定义统一类型；
2. 创建冰水 Demo fixture；
3. 建立 Mock Adapter；
4. 建立 Timeline Engine；
5. 让视频时间能正确驱动知识点状态。

## Phase 2：链路 2

1. 常驻知识窗口；
2. 问题状态；
3. 正在讲解状态；
4. 剩余时间；
5. 动态进度；
6. 知识点结束后显示答案；
7. 切换下一问题。

## Phase 3：链路 1

1. 三种轻提示共用容器；
2. 按 type 渲染贴图和文案；
3. 完整提示；
4. 缩小提示；
5. 忽略后写入知识列表；
6. 点击后暂停；
7. 展开详情；
8. 关闭后恢复播放。

## Phase 4：本视频知识点

1. 右上角知识点图标；
2. 未读角标；
3. Bottom Sheet；
4. 知识点栏目；
5. 回到原片；
6. 全文栏目；
7. 我的笔记；
8. 本地持久化。

## Phase 5：冲突和边界

1. 链路 1 出现时链路 2 折叠；
2. 抽屉打开时暂停；
3. 跳转后重新计算；
4. 视频拖动；
5. 快进越过触发点；
6. 回看；
7. 多个补丁接近；
8. 视频结束。

## Phase 6：视觉与动效替换

等精细 UI 和最终 Skill 数据到位后再处理：

- 最终贴图；
- 310×180 展开卡；
- 动效节奏；
- 品牌色；
- 真实接口；
- 错误与加载状态。

---

# 21. Demo 验收标准

以下全部通过，才算基础 Demo 完成。

## H5 与手机适配

- [ ] 手机浏览器中页面宽度正确，无额外设备外框；
- [ ] iOS Safari 中视频保持页内播放；
- [ ] Android Chrome 中视频、抽屉和时间轴正常；
- [ ] 浏览器地址栏伸缩时布局不明显跳动；
- [ ] 顶部和底部安全区域正确；
- [ ] 抽屉打开后背景不滚动；
- [ ] 浏览器返回优先关闭当前抽屉；
- [ ] 软键盘弹出时笔记输入框可见；
- [ ] 自动播放失败时有明确回退。

## 视频

- [ ] 示例视频能播放、暂停、拖动；
- [ ] 当前时间正确更新；
- [ ] 跳转知识点位置准确；
- [ ] 抽屉打开时视频暂停。

## 链路 2

- [ ] 视频一开始窗口就出现；
- [ ] 显示当前或下一个知识点问题；
- [ ] 显示正在讲解状态；
- [ ] 显示剩余时间；
- [ ] 进度条随视频走；
- [ ] 讲解结束切换答案；
- [ ] 答案停留后切换下一问题；
- [ ] 点击进入全部知识点列表。

## 链路 1

- [ ] 三种需求都能触发；
- [ ] 轻提示不遮挡视频；
- [ ] 点击后暂停并展开；
- [ ] 忽略后先缩小再消失；
- [ ] 消失后知识点仍能在列表中找回；
- [ ] 关闭后继续播放；
- [ ] 已查看状态被保存；
- [ ] 链路 1 出现时链路 2 不与其重叠。

## 本视频知识点

- [ ] 右上角图标存在；
- [ ] 未查看数量角标准确；
- [ ] 打开为非全屏底部抽屉；
- [ ] 上方视频仍可见；
- [ ] 三个栏目可切换；
- [ ] 知识点可展开和回到原片；
- [ ] 全文可按时间跳转；
- [ ] 笔记可新增、编辑和删除；
- [ ] 刷新后笔记仍在。

## 代码质量

- [ ] 无散落的时间点硬编码；
- [ ] 无 UI 直接调用模型；
- [ ] 类型完整；
- [ ] 核心时间轴有测试；
- [ ] `lint`、`typecheck`、`test` 通过；
- [ ] 不破坏原有页面。

---

# 22. 核心测试场景

至少覆盖：

1. 正常播放进入第一个知识点；
2. 链路 1 轻提示被点击；
3. 链路 1 轻提示被忽略；
4. 提示淡出后从知识点抽屉重新打开；
5. 链路 1 展开期间链路 2 保持暂停；
6. 关闭详情后恢复到原知识点前；
7. 两个补丁间隔很近；
8. 用户快进越过补丁；
9. 用户拖回补丁位置；
10. 链路 2 知识点结束切答案；
11. 点击常驻窗口打开知识列表；
12. 从知识点列表跳回视频；
13. 全文点击时间戳；
14. 添加笔记并刷新；
15. 无补丁视频；
16. 无知识点视频；
17. 视频播放结束。

---

# 23. Skill / Harness 接入约定

## 链路 1

当前 Skill 仍在打磨。前端不要依赖提示词文本，只依赖稳定 JSON Schema。

未来可能从单 Skill 升级为 Harness：

```text
候选识别
→ 分类与评级
→ 三类分支生成
→ 统一审核
```

前端只消费最终 `UnderstandingSupplement[]`。

## 链路 2

Harness 已明确由：

```text
知识点识别
→ 问题生成
→ 答案生成
```

前端只消费最终 `VideoKnowledgePoint[]`。

任何 Prompt 变化不应要求修改页面组件。

---

# 24. 医疗与事实核查示例注意事项

当前“喝冰水伤胃吗”仅作为产品 Demo 内容。

要求：

- 不把 Demo 文案当正式医疗建议；
- 不用简单“真 / 假”标签；
- 采用中立、有条件的表达；
- 不虚构权威来源；
- 真实接入时，来源由后端或核验模块提供；
- 前端只展示数据，不自行拼接医学结论。

---

# 25. Codex 每次任务的执行格式

开始修改前：

1. 阅读本文件；
2. 检查仓库；
3. 简述当前实现；
4. 列出将修改的文件；
5. 指出假设；
6. 再开始编码。

完成后：

1. 总结改动；
2. 列出关键文件；
3. 给出运行命令；
4. 给出测试结果；
5. 说明尚未实现的内容；
6. 不宣称未验证的功能已经完成。

---

# 26. 当前已经确定、不再反复讨论的产品决策

- 产品形态是适配手机的 H5 Web 应用；
- 当前不是原生 App，也不是小程序；
- 两条链路同时存在；
- 链路 1 是内容理解补丁；
- 链路 2 是视频知识导航；
- 链路 1 只解决三类需求；
- 链路 2 视频开始即常驻；
- 链路 2 点击后进入全部知识点；
- 链路 1 轻提示不遮挡视频；
- 轻提示忽略后会消失，但内容保留；
- 右上角增加“本视频知识点”图标；
- 知识点抽屉不是全屏；
- 抽屉包含“知识点 / 全文 / 我的笔记”；
- AI 图标与知识点图标职责不同；
- 当前先用 Mock 数据跑通；
- 后续再上传最终 Skill、精细 UI 和动画资源替换。

---

# 27. 仍可调整的内容

以下尚未最终锁死，应设计为可配置或可替换：

- 链路 1 最终是否采用单 Skill 或 Harness；
- 轻提示最终视觉样式；
- 展开详情贴图风格；
- 310×180 卡片最终布局；
- 具体动画；
- 品牌色；
- 真实后端接口；
- 知识点图标最终形态；
- 笔记导出格式；
- 各提示停留时长；
- 密集知识点的合并策略。

不要把这些未定内容写死在不可替换的组件中。

---

# 28. 最终开发判断标准

当出现设计或代码分歧时，按以下顺序判断：

1. 是否保持视频是主体；
2. 是否让用户更容易看懂；
3. 是否明确区分两条链路；
4. 是否不遮挡视频；
5. 是否能找回错过的知识；
6. 是否能绑定准确时间点；
7. 是否可替换 Skill 和 UI；
8. 是否比当前方案更简单；
9. 是否符合 Demo 范围；
10. 是否已经真实验证。

最终目标不是堆功能，而是让 Demo 清楚呈现：

> AI 一边把视频知识主干组织成可跟随的问题和答案，一边在用户可能卡住的地方补上解释、求真和直观参照。

---

# 29. 万相 2.7 Image Pro 配置

链路1需要视觉资源时，默认生图模型配置为：

```text
Provider: 阿里云百炼 / 万相
Model: wan2.7-image-pro
Endpoint: POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
```

## 29.1 安全规则

- API Key 只能存在于服务端环境变量 `DASHSCOPE_API_KEY`；
- 禁止写入仓库、前端代码、Fixture、Trace、日志和错误响应；
- 禁止使用 `VITE_*`、`NEXT_PUBLIC_*` 等会进入浏览器的变量；
- H5 不得直接请求百炼生图 API；
- 服务端必须提供受控的 Harness Tool 或内部接口；
- 已在聊天、Issue、提交记录中暴露的 Key 必须撤销并重新生成。

## 29.2 Harness 调用位置

```text
Skill输出问题、答案、视觉语义计划和生图Prompt
→ Adapter统一格式
→ Arbiter确认保留
→ Content Grader通过
→ Wan 2.7 Image Tool
→ Visual Grader
→ 素材持久化
→ 写入最终视频时间轴
```

生图模型是 Harness 的 Tool，不属于三个 Skill 本身。Skill 不得直接发起网络请求。

## 29.3 已锁定的三类渲染策略

链路1三类内容采用不同的最终渲染路径：

```text
抽象变直观
→ Skill生成问题、答案、视觉结构和完整卡片生图Prompt
→ 万相2.7直接生成包含少量中文文字的完整卡片图片

知识断层
→ Skill生成问题、答案、视觉语义和完整卡片生图Prompt
→ 万相2.7直接生成包含少量中文文字的完整卡片图片

验证真假
→ Skill生成问题、答案、核验状态、条件和证据摘要
→ 展开详情不调用生图模型
→ 前端填入固定验证卡组件
```

三类内容只要进入 `auto_prompt`，都可以由 Harness 额外生成一张独立的轻提示贴图。轻提示贴图与展开详情的渲染策略互不替代：验证真假仍然不生成完整详情卡图片。

不要把前两类改成“只生成贴纸，再由代码填文字”。前两类 Skill 已经严格限制图片中的文字数量和卡片结构，当前产品决策是直接生出完整卡片。

这里的“框架限定”是指：

- 图片在H5中出现的位置；
- 容器尺寸；
- 轻提示与展开方式；
- 圆角、边距和动画；
- 图片在页面中的适配规则。

它不代表用代码重新拼装图片内部的问题、答案和贴图。

生图请求统一使用：

```text
full-card:
  size: 2K
  ratio: 16:9
  routes:
    - abstract_to_intuitive
    - knowledge_gap
```

万相完整卡使用 2K 的 `2560×1440` 生成，再由服务端居中裁切和缩放至 `930×540` 的 3 倍屏资源；H5 展示尺寸仍为 `310×180` CSS px。Prompt 必须把重要问题、答案和视觉主体放在中心安全区。

`claim_verification` 必须强制：

```text
visual.required = false
```

这里的 `visual.required` 只约束展开详情的完整卡片，不禁止 Harness 生成轻提示贴图。

轻提示左侧区域只定义贴图位置和展示尺寸，不绘制灰色底或其他占位背景。轻提示贴图统一使用：

```text
hint-sticker:
  size: 2K
  ratio: 1:1
  target: 120×120 PNG
  display: 40×40 CSS px
  routes:
    - abstract_to_intuitive
    - knowledge_gap
    - claim_verification
```

轻提示贴图风格遵循“统一卡通贴纸风提示词生成器”规范：精致 Sticker Illustration、扁平 2.5D、内部深色粗描边、外部完整连续的粗白色模切边框、柔和渐变、少量高光、轻微阴影和 Emoji 式轻拟物质感。配色明快但不过度饱和；单个完整主体居中，占画面约 70%～80%，四周均匀留白且不得裁切；透明背景优先，无法透明时使用与主体边缘分离的纯白背景，再由服务端只清除与画布四边连通的近白背景，保留主体白色模切边框。必须禁止文字、数字、水印、品牌标志、界面元素、复杂场景、写实摄影、复杂 3D、黏土、毛绒、多个分散主体、结构错误和拟人化五官。

三类语义都要收敛为一个紧凑主体：验证真假将主题对象和放大镜/核验动作融合为一个主体；抽象变直观使用一个物体或刻度隐喻；知识断层使用一个具体物体或结构隐喻。生成失败时该位置保持透明，不得显示灰色底，也不得阻塞轻提示或整条视频进入可播放状态。

## 29.4 请求规则

文生图必须包含：

```text
model
input.messages
parameters.size
```

完整卡的 2K 16:9 请求参数：

```json
{
  "size": "2560*1440",
  "n": 1,
  "watermark": false,
  "thinking_mode": true
}
```

轻提示贴图的 2K 方图请求参数：

```json
{
  "size": "2048*2048",
  "n": 1,
  "watermark": false,
  "thinking_mode": true
}
```

不要假定返回 URL 永久有效；拿到 URL 后必须立即持久化。

## 29.5 运行配置

```env
DASHSCOPE_API_KEY=
DASHSCOPE_IMAGE_ENDPOINT=https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
DASHSCOPE_IMAGE_MODEL=wan2.7-image-pro
DASHSCOPE_IMAGE_TIMEOUT_MS=180000
DASHSCOPE_IMAGE_MAX_RETRIES=2
CHAIN1_HINT_STICKER_ENABLED=true
CHAIN1_HINT_STICKER_MAX_ATTEMPTS=1
```

API 返回 URL 后必须立即持久化到项目自己的对象存储或 Demo 资源目录。

## 29.6 失败与降级

```text
第一次失败
→ 根据错误类型决定是否重试

429 / 5xx / 超时
→ 最多重试2次

视觉语义审核失败
→ 修正Prompt后最多重新生成2次

仍然失败
→ 使用模板插图或无图卡片
```

不得因为生图失败阻塞整条视频进入 `ready`。抽象变直观和知识断层可以降级为文字详情；验证真假本身始终使用结构化详情模板。轻提示贴图失败时保留灰色占位并记录 fallback。
