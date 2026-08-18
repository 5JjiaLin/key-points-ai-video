import { useMemo, useState } from 'react'
import type { LearningPathViewModel } from '../../domain/learning'
import type { LearningField, LearningFieldId } from './learning.types'
import {
  LEARNING_PATH_STAGE_DESCRIPTION_MAX_LENGTH,
  LEARNING_PATH_STAGE_TITLE_MAX_LENGTH,
  LEARNING_PATH_THEME_MAX_LENGTH,
  limitLearningPathText,
} from './learning.constants'
import './learningPath.css'

const assetRoot = '/assets/multi-video'
const pathAssetRoot = `${assetRoot}/learning-path`

interface LearningPathPageProps {
  field: LearningField
  question: string
  path?: LearningPathViewModel | null
  onBack: () => void
  onStart: (stageIndex: number) => void
  progressByStage?: number[]
}

export interface LearningStage {
  title: string
  description: string
}

const summaryBackgroundByField: Record<LearningFieldId, string> = {
  astronomy: `${pathAssetRoot}/path-bg-astronomy.webp`,
  geography: `${pathAssetRoot}/path-bg-geography.webp`,
  history: `${pathAssetRoot}/path-bg-history.webp`,
  'life-science': `${pathAssetRoot}/path-bg-life-science.webp`,
  technology: `${pathAssetRoot}/path-bg-technology.webp`,
  economy: `${pathAssetRoot}/path-bg-economy.webp`,
  'physics-chemistry': `${pathAssetRoot}/path-bg-technology.webp`,
  'food-nutrition': `${pathAssetRoot}/path-bg-life-science.webp`,
}

export const stagesByField: Record<LearningFieldId, LearningStage[]> = {
  astronomy: [
    { title: '138亿年前·宇宙大爆炸', description: '宇宙从奇点开始膨胀，时间与空间诞生' },
    { title: '宇宙膨胀与星系形成', description: '物质冷却凝聚，恒星与星系逐渐形成' },
    { title: '恒星诞生与演化', description: '从星云到主序星，再到红巨星与超新星' },
    { title: '黑洞的形成与特性', description: '大质量恒星坍缩形成黑洞，时空极端弯曲' },
    { title: '暗物质与宇宙未来', description: '暗物质主导宇宙结构，宇宙将持续膨胀' },
    { title: '观测宇宙的方法', description: '从光谱、引力波到全球望远镜协作观测' },
  ],
  geography: [
    { title: '地球内部的能量', description: '地幔对流为板块运动提供持续动力' },
    { title: '板块边界与地震', description: '碰撞、张裂与错动塑造活跃地质带' },
    { title: '山脉与高原形成', description: '大陆碰撞抬升地表并重塑区域气候' },
    { title: '河流塑造地貌', description: '侵蚀与沉积共同形成峡谷和平原' },
    { title: '气候系统运转', description: '纬度、环流与洋流控制水热分布' },
    { title: '人类活动与环境', description: '城市、农业与资源利用改变自然过程' },
  ],
  history: [
    { title: '早期文明的形成', description: '农业、城市与文字推动复杂社会出现' },
    { title: '国家制度的演进', description: '法律、官僚与税收建立稳定治理体系' },
    { title: '贸易网络扩展', description: '陆路与海路交换商品、技术和观念' },
    { title: '城市与日常生活', description: '市场、手工业与社区构成文明肌理' },
    { title: '冲突与文化融合', description: '战争、迁徙与交流不断重塑社会' },
    { title: '历史证据的方法', description: '结合文献与考古重建可靠历史叙事' },
  ],
  'life-science': [
    { title: '细胞与生命边界', description: '细胞膜维持物质交换和内部稳定' },
    { title: '遗传信息表达', description: '基因通过调控影响性状与生命活动' },
    { title: '能量获取与代谢', description: '生命将外界物质转化为可用能量' },
    { title: '免疫与稳态调节', description: '多层防御识别威胁并维持机体平衡' },
    { title: '进化与物种形成', description: '遗传变异和自然选择积累适应差异' },
    { title: '生态系统协作', description: '物种通过食物网与环境相互影响' },
  ],
  technology: [
    { title: '信息如何被编码', description: '数字系统用离散信号表示复杂信息' },
    { title: '芯片完成计算', description: '晶体管组合逻辑并执行基础运算' },
    { title: '网络传递数据', description: '协议、路由与纠错保障可靠通信' },
    { title: '传感器理解世界', description: '物理信号被采集并转化为数字数据' },
    { title: '人工智能学习', description: '模型从数据中提取模式并完成预测' },
    { title: '技术系统的边界', description: '安全、能耗与伦理共同约束技术应用' },
  ],
  economy: [
    { title: '稀缺与个人选择', description: '资源有限促使人们比较成本与收益' },
    { title: '价格如何形成', description: '供给和需求共同传递市场信息' },
    { title: '企业组织生产', description: '分工、激励与管理提高协作效率' },
    { title: '金融连接时间', description: '储蓄、投资与风险交换配置未来资源' },
    { title: '公共政策调节', description: '税收、支出与规则影响整体经济运行' },
    { title: '全球经济联系', description: '贸易、资本与技术跨区域流动' },
  ],
  'physics-chemistry': [
    { title: '物质的组成', description: '原子与分子构成一切物质的基础' },
    { title: '物质的三态与相变', description: '温度与压强改变物质的存在形态' },
    { title: '化学反应的本质', description: '原子重新组合并伴随能量变化' },
    { title: '能量转化与守恒', description: '能量在反应中转移但总量不变' },
    { title: '电与磁的原理', description: '电荷运动产生电流与磁场效应' },
    { title: '光与物质相互作用', description: '光的波粒二象性解释多种现象' },
  ],
  'food-nutrition': [
    { title: '三大营养素', description: '蛋白质、脂肪与碳水提供能量和结构' },
    { title: '维生素与矿物质', description: '微量营养素维持身体正常运转' },
    { title: '消化与吸收', description: '食物在体内被分解并转化为养分' },
    { title: '血糖与代谢', description: '糖分摄入影响血糖与能量储存' },
    { title: '均衡饮食结构', description: '合理搭配三餐满足身体需求' },
    { title: '食品安全与添加剂', description: '科学看待加工食品与添加成分' },
  ],
}

export function LearningPathPage({ field, question, path, onBack, onStart, progressByStage = [] }: LearningPathPageProps) {
  const stages = useMemo(() => path
    ? path.stages.map((stage) => ({
      id: stage.id,
      title: limitLearningPathText(stage.title, LEARNING_PATH_STAGE_TITLE_MAX_LENGTH),
      description: limitLearningPathText(stage.description, LEARNING_PATH_STAGE_DESCRIPTION_MAX_LENGTH),
      nodeCount: stage.nodes.length,
    }))
    : stagesByField[field.id].map((stage, index) => ({
      id: `${field.id}-${index}`,
      title: limitLearningPathText(stage.title, LEARNING_PATH_STAGE_TITLE_MAX_LENGTH),
      description: limitLearningPathText(stage.description, LEARNING_PATH_STAGE_DESCRIPTION_MAX_LENGTH),
      nodeCount: 1,
    })), [field.id, path])
  const theme = limitLearningPathText(path?.title || question || field.topic || field.name, LEARNING_PATH_THEME_MAX_LENGTH)
  const videoCount = path?.videoCount ?? 6
  const durationLabel = path ? `${path.estimatedMinutes}分钟` : '60–90分钟'
  const [activeStage, setActiveStage] = useState(0)

  return (
    <div className="learning-flow-page learning-path-page">
      <img className="learning-flow-status learning-path-status" src={`${assetRoot}/status-bar.svg`} alt="9:41，手机状态栏" />
      <button className="learning-flow-back learning-path-back" aria-label="返回上一页" onClick={onBack} type="button">
        <img src={`${assetRoot}/flow-back.svg`} alt="" />
      </button>

      <header className="learning-path-hero">
        <div>
          <h1>学习路径已生成</h1>
          <p>AI已为你整理出系统学习路径</p>
        </div>
        <img src={`${pathAssetRoot}/path-hero-book.png`} alt="打开的学习路径书本插图" />
      </header>

      <section className="learning-path-summary" aria-labelledby="learning-path-theme">
        <img
          className="learning-path-summary-art"
          src={summaryBackgroundByField[field.id]}
          alt={`${field.name}主题背景`}
        />
        <div className="learning-path-summary-overlay" />
        <div className="learning-path-summary-content">
          <h2 id="learning-path-theme">{theme}</h2>
          <p>已整理 <strong>{videoCount}</strong> 条视频 · <strong>{stages.length}</strong> 个关键阶段</p>
          <div className="learning-path-metrics">
            <div>
              <img src={`${pathAssetRoot}/path-duration-icon.png`} alt="" />
              <span><small>预计学习时长</small><strong>{durationLabel}</strong></span>
            </div>
            <div>
              <img src={`${pathAssetRoot}/path-target-icon.png`} alt="" />
              <span><small>掌握目标</small><strong>80%以上</strong></span>
            </div>
          </div>
        </div>
      </section>

      <section className="learning-path-overview" aria-labelledby="learning-path-overview-title">
        <h2 id="learning-path-overview-title">知识点概览</h2>
        <div className="learning-path-stage-list">
          {stages.map((stage, index) => (
            <button
              aria-pressed={activeStage === index}
              className={activeStage === index ? 'active' : ''}
              key={stage.id}
              onClick={() => setActiveStage(index)}
              type="button"
            >
              <span className="learning-path-stage-copy">
                <strong>{stage.title}</strong>
                <small>{stage.nodeCount} 个知识点</small>
                <span>{stage.description}</span>
              </span>
              <span className="learning-path-stage-progress">
                {Math.min(100, Math.max(0, progressByStage[index] ?? 0))}%
              </span>
              <img src={`${assetRoot}/field-chevron.svg`} alt="" />
            </button>
          ))}
        </div>
      </section>

      <footer className="learning-path-footer">
        <button onClick={() => onStart(activeStage)} type="button">开始学习</button>
      </footer>
    </div>
  )
}
