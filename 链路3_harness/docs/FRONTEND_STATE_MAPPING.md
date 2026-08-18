# 前端状态映射

| Harness状态 | 页面文案 |
|---|---|
| assessing_video_set | 正在确认视频主题与范围 |
| extracting_source_knowledge | 正在提取每条视频的知识点 |
| normalizing_knowledge | 正在统一不同视频的知识表达 |
| building_relations | 正在建立前置、互补和观点关系 |
| recommending_questions | 正在生成适合的研究问题 |
| awaiting_question | 请选择本次研究问题 |
| parsing_intent | 正在理解你的学习目标 |
| planning_path | 正在筛选并重构知识 |
| calculating_duration | 正在计算学习时间 |
| reviewing_path | 正在检查学习路径 |
| completed | 学习路径已生成 |
| needs_review | 当前路径需要进一步校准 |
| failed | 分析失败，可查看具体步骤 |

前端显示必须对应真实后端状态，不要再增加一条和实际执行无关的“AI正在深度思考”。旋转球体并不会因此获得思想。
