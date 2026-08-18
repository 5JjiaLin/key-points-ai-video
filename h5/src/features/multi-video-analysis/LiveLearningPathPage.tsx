import { useState } from 'react'
import type { LearningPathViewModel } from '../../domain/learning'
import type { LearningField } from './learning.types'
import './learningPath.css'

const assetRoot = '/assets/multi-video'
const pathAssetRoot = `${assetRoot}/learning-path`

export function LiveLearningPathPage({ field, path, progressByStage = [], onBack, onStart }: {
  field: LearningField
  path: LearningPathViewModel
  progressByStage?: number[]
  onBack: () => void
  onStart: (stageIndex: number) => void
}) {
  const [activeStage, setActiveStage] = useState(0)
  return (
    <div className="learning-flow-page learning-path-page">
      <img className="learning-flow-status learning-path-status" src={`${assetRoot}/status-bar.svg`} alt="9:41，手机状态栏" />
      <button className="learning-flow-back learning-path-back" aria-label="返回上一页" onClick={onBack} type="button"><img src={`${assetRoot}/flow-back.svg`} alt="" /></button>
      <header className="learning-path-hero"><div><h1>学习路径已生成</h1><p>AI已为你整理出可追溯的系统学习路径</p></div><img src={`${pathAssetRoot}/path-hero-book.png`} alt="打开的学习路径书本插图" /></header>
      <section className="learning-path-summary" aria-labelledby="learning-path-theme">
        <img className="learning-path-summary-art" src={field.iconUrl} alt="" /><div className="learning-path-summary-overlay" />
        <div className="learning-path-summary-content">
          <h2 id="learning-path-theme">{path.title}</h2><p>已整理 <strong>{path.videoCount}</strong> 条视频 · <strong>{path.stages.length}</strong> 个学习阶段</p>
          <div className="learning-path-metrics">
            <div><img src={`${pathAssetRoot}/path-duration-icon.png`} alt="" /><span><small>预计学习时长</small><strong>{path.estimatedMinutes}分钟</strong></span></div>
            <div><img src={`${pathAssetRoot}/path-target-icon.png`} alt="" /><span><small>路径依据</small><strong>真实视频片段</strong></span></div>
          </div>
        </div>
      </section>
      <section className="learning-path-overview" aria-labelledby="learning-path-overview-title">
        <h2 id="learning-path-overview-title">知识点概览</h2>{path.coverageNote && <p>{path.coverageNote}</p>}
        <div className="learning-path-stage-list">
          {path.stages.map((stage, index) => (
            <button className={activeStage === index ? 'active' : ''} key={stage.id} onClick={() => setActiveStage(index)} type="button">
              <span className="learning-path-stage-copy"><strong>{stage.title}</strong><small>{stage.nodes.length} 个知识点</small><span>{stage.description}</span></span>
              <span className="learning-path-stage-progress">{progressByStage[index] ?? 0}%</span><img src={`${assetRoot}/field-chevron.svg`} alt="" />
            </button>
          ))}
        </div>
      </section>
      <footer className="learning-path-footer"><button onClick={() => onStart(activeStage)} type="button">开始学习</button></footer>
    </div>
  )
}
