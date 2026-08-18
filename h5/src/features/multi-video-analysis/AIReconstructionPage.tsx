import { useEffect, useMemo, useState } from 'react'
import type { LearningField } from './learning.types'
import './aiReconstruction.css'

const assetRoot = '/assets/multi-video'

interface AIReconstructionPageProps {
  field: LearningField
  loadingVideoSrc?: string
  progress?: number
  onBack: () => void
  onBrowseVideos: () => void
  onComplete: () => void
}

const reconstructionSteps = ['解析视频', '提取知识点', '建立关联', '生成路径']
const progressMilestones = [4, 9, 16, 24, 34, 45, 57, 68, 77, 85, 91, 96, 100]

function emotionalMessage(progress: number) {
  if (progress < 25) return '我正在认真看完每一段视频，不放过任何重要细节～'
  if (progress < 50) return '已经发现不少有价值的知识点啦，继续帮你提炼中'
  if (progress < 75) return '零散的知识正在连成清晰脉络，再给我一点时间'
  if (progress < 100) return '最后帮你排好学习顺序，很快就可以开始探索啦'
  return '学习路径已经整理好，准备开启这次知识探索吧！'
}

function CompletedMark() {
  return <img src={`${assetRoot}/selected-checkbox.svg`} alt="" />
}

export function AIReconstructionPage({
  field,
  loadingVideoSrc,
  progress: reportedProgress,
  onBack,
  onBrowseVideos,
  onComplete,
}: AIReconstructionPageProps) {
  const [simulatedProgress, setSimulatedProgress] = useState(progressMilestones[0])

  useEffect(() => {
    if (reportedProgress !== undefined) return
    let milestoneIndex = 0
    const timer = window.setInterval(() => {
      milestoneIndex += 1
      setSimulatedProgress(progressMilestones[Math.min(milestoneIndex, progressMilestones.length - 1)])
      if (milestoneIndex >= progressMilestones.length - 1) window.clearInterval(timer)
    }, 1100)
    return () => window.clearInterval(timer)
  }, [reportedProgress])

  const progress = Math.min(100, Math.max(0, Math.round(reportedProgress ?? simulatedProgress)))
  const activeStageIndex = progress === 100 ? reconstructionSteps.length : Math.min(3, Math.floor(progress / 25))
  const message = useMemo(() => emotionalMessage(progress), [progress])

  useEffect(() => {
    if (progress !== 100) return
    const timer = window.setTimeout(onComplete, 1800)
    return () => window.clearTimeout(timer)
  }, [onComplete, progress])

  return (
    <div className="learning-flow-page ai-reconstruction-page">
      <img className="learning-flow-status ai-reconstruction-status" src={`${assetRoot}/status-bar.svg`} alt="9:41，手机状态栏" />

      <button className="learning-flow-back ai-reconstruction-back" aria-label="返回选择研究问题" onClick={onBack} type="button">
        <img src={`${assetRoot}/flow-back.svg`} alt="" />
      </button>

      <header className="ai-reconstruction-header">
        <h1>AI重构进行中</h1>
      </header>

      <main className="ai-reconstruction-content">
        <section className="ai-reconstruction-intro" aria-labelledby="ai-reconstruction-title">
          <h2 id="ai-reconstruction-title">正在为你整理学习路径</h2>
          <p>AI正在解析视频、提取知识点并生成系统化学习内容</p>
        </section>

        <div className={`ai-reconstruction-media ${loadingVideoSrc ? 'has-video' : ''}`} aria-label={`${field.name}加载动画区域`}>
          {loadingVideoSrc ? (
            <video autoPlay loop muted playsInline src={loadingVideoSrc} />
          ) : (
            <span>加载动画视频预留位</span>
          )}
        </div>

        <section className="ai-reconstruction-progress-card" aria-label="AI重构进度">
          <ol className="ai-reconstruction-stages">
            {reconstructionSteps.map((step, index) => {
              const state = progress === 100 || index < activeStageIndex
                ? 'complete'
                : index === activeStageIndex ? 'active' : 'pending'
              return (
              <li className={state} key={step}>
                <span className="ai-stage-icon" aria-hidden="true">
                  {state === 'complete' ? <CompletedMark /> : <span className="ai-stage-pulse" />}
                </span>
                <span>{step}</span>
              </li>
              )
            })}
          </ol>

          <strong className="ai-reconstruction-percent">{progress}<span>%</span></strong>
          <div className="ai-reconstruction-progress-track" role="progressbar" aria-label="AI重构进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>

          <p className="ai-reconstruction-emotional-copy" aria-live="polite">
            <span aria-hidden="true" />
            {message}
          </p>
        </section>

        <section className="ai-reconstruction-leave-card" aria-label="离开当前页面">
          <div className="ai-reconstruction-play-icon" aria-hidden="true">
            <img src="/assets/knowledge-sheet-play.svg" alt="" />
          </div>
          <div className="ai-reconstruction-leave-copy">
            <h2>你可以先去刷视频</h2>
            <p>重构不会中断，完成后会提醒你<br />继续刷视频时，顶部会出现轻提示</p>
          </div>
          <button onClick={onBrowseVideos} type="button">去刷视频</button>
        </section>

        <aside className="ai-reconstruction-estimate">
          <span className="ai-reconstruction-info" aria-hidden="true">i</span>
          <p>AI重构预计需要1–2分钟，请耐心等待～</p>
        </aside>
      </main>
    </div>
  )
}
