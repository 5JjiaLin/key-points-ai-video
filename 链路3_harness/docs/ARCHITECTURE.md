# 链路3 Harness 架构

## 1. 五个核心元素

### Task

多视频知识重构任务，包括：

- 视频集合；
- 用户选择模式；
- 主题提示；
- 研究问题；
- 内容版本。

### Environment

每次运行保存快照：

- Harness配置版本；
- Skill版本；
- 模型Provider；
- 视频元数据；
- 缓存命中；
- 运行时间。

### Tools

v1内置：

- 文件缓存；
- JSON Schema校验；
- 图环检测；
- 时间计算；
- HTTP模型Provider；
- Fixture Provider。

ASR、OCR、关键帧和搜索应作为外部Tool接入。

### Trace

每次Skill调用记录：

- Skill ID和版本；
- 输入/输出哈希；
- 缓存命中；
- 尝试次数；
- 耗时；
- 校验错误；
- 局部重跑原因。

### Grader

两层：

```text
确定性Grader
→ Schema、ID、时间、来源、图环、顺序、时长

语义Grader
→ S7路径独立审核
```

## 2. 稳定知识层

```text
VideoSetAssessment
↓
SourceKnowledgePoint[]
↓
CanonicalKnowledgeNode[]
↓
KnowledgeRelation[] + SourceAlignment[]
↓
TopicKnowledgeProfile
```

稳定层缓存键不包含用户研究问题。

## 3. 动态路径层

```text
TopicKnowledgeProfile
+
ResearchQuestion
↓
ResearchIntent
↓
FilterDecision[] + LearningPath
↓
Duration Calculation
↓
Path Review
```

## 4. 局部重跑

| retry_step | 重跑内容 |
|---|---|
| intent_parsing | S5及下游 |
| knowledge_filtering | S6筛选与下游 |
| path_planning | S6编排与下游 |
| source_selection | S6来源选择与下游 |
| duration_calculation | 时间计算与S7 |
| knowledge_normalization | 需要重建稳定层 |
| relation_building | 需要重建稳定层 |
| manual_review | 停止自动重试 |

稳定层错误不会在当前动态循环中草率修复，而是返回明确错误，要求重建TopicKnowledgeProfile。否则一个路径审核器可能悄悄改写底层知识，系统就开始自我篡史。

## 5. 缓存

### source-knowledge

```text
video_id
+ content_version
+ extraction_mode
+ extraction_skill_version
```

### topic-profile

```text
included_video_ids
+ source_points_hash
+ analysis_mode
+ normalization_version
+ relation_version
```

### learning-path

```text
topic_profile_id
+ research_intent
+ planner_version
+ reviewer_version
```
