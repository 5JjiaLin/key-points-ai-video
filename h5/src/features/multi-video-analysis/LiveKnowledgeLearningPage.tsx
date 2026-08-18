import { useEffect, useMemo, useRef, useState } from 'react'
import type { LearningPathViewModel } from '../../domain/learning'
import type { LearningField } from './learning.types'
import './knowledgePointLearning.css'
import './liveLearning.css'

const assetRoot = '/assets/multi-video'
const formatTime = (seconds: number) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`

export function LiveKnowledgeLearningPage({ field, path, initialStageIndex, progressByStage = [], onBack, onComplete }: {
  field: LearningField
  path: LearningPathViewModel
  initialStageIndex: number
  progressByStage?: number[]
  onBack: () => void
  onComplete: (completedStageIndexes: number[]) => void
}) {
  const [stageIndex, setStageIndex] = useState(Math.min(path.stages.length - 1, Math.max(0, initialStageIndex)))
  const [nodeIndex, setNodeIndex] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [answerOpen, setAnswerOpen] = useState(false)
  const [completedStages, setCompletedStages] = useState<Set<number>>(() => new Set())
  const videoRef = useRef<HTMLVideoElement>(null)
  const stage = path.stages[stageIndex]
  const nodes = stage?.nodes ?? []
  const node = nodes[nodeIndex]
  const source = node?.source
  const clipDuration = source ? Math.max(1, source.endTime - source.startTime) : 1
  const visibleSupplement = useMemo(() => source?.supplements.find((item) => item.triggerTime <= source.startTime + currentTime), [currentTime, source])

  useEffect(() => { setNodeIndex(0); setCurrentTime(0); setAnswerOpen(false) }, [stageIndex])
  useEffect(() => {
    setCurrentTime(0); setAnswerOpen(false)
    if (videoRef.current && source) videoRef.current.currentTime = source.startTime
  }, [nodeIndex, source])

  if (!stage || !node || !source) return <main className="player-feed-empty"><button onClick={onBack} type="button">返回学习路径</button><p>当前阶段没有可播放的来源片段</p></main>

  const finishNode = () => {
    const next = new Set(completedStages).add(stageIndex)
    setCompletedStages(next)
    if (nodeIndex < nodes.length - 1) return setNodeIndex((value) => value + 1)
    if (stageIndex < path.stages.length - 1) return setStageIndex((value) => value + 1)
    onComplete([...next].sort((a, b) => a - b))
  }

  return (
    <div className="learning-flow-page knowledge-learning-page">
      <img className="learning-flow-status knowledge-learning-status" src={`${assetRoot}/status-bar.svg`} alt="9:41，手机状态栏" />
      <button className="learning-flow-back knowledge-learning-back" aria-label="返回学习路径" onClick={onBack} type="button"><img src={`${assetRoot}/flow-back.svg`} alt="" /></button>
      <header className="knowledge-learning-header"><h1>知识点学习</h1></header>
      <main className="knowledge-learning-content">
        <section className="knowledge-learning-summary"><div><h2>{node.title}</h2><span>{nodeIndex + 1}/{nodes.length}个知识点</span></div><strong>{progressByStage[stageIndex] ?? 0}%</strong><p>{node.goal || stage.description}</p></section>
        <section className="knowledge-fragment-section">
          <h2>来源讲解片段</h2>
          <div className="knowledge-main-fragment">
            <video ref={videoRef} controls onLoadedMetadata={(event) => { event.currentTarget.currentTime = source.startTime }} onTimeUpdate={(event) => {
              const absolute = event.currentTarget.currentTime
              if (absolute >= source.endTime) { event.currentTarget.pause(); event.currentTarget.currentTime = source.endTime }
              setCurrentTime(Math.max(0, Math.min(clipDuration, absolute - source.startTime)))
            }} playsInline src={source.videoUrl} />
            <div className="knowledge-player-controls"><time>{formatTime(currentTime)}</time><input aria-label="片段播放进度" max={clipDuration} min={0} onChange={(event) => { const next = Number(event.target.value); if (videoRef.current) videoRef.current.currentTime = source.startTime + next; setCurrentTime(next) }} type="range" value={currentTime} /><time>{formatTime(clipDuration)}</time></div>
          </div>
          <div className="knowledge-fragment-list">{nodes.map((item, index) => <button className={nodeIndex === index ? 'active' : ''} key={item.id} onClick={() => setNodeIndex(index)} type="button"><span className="knowledge-fragment-cover"><img src={field.iconUrl} alt="" /></span><span className="knowledge-fragment-copy"><strong>{item.title}</strong><small>{item.source.creator}<i />{formatTime(item.source.endTime - item.source.startTime)}</small></span></button>)}</div>
        </section>
        {visibleSupplement && <aside className="live-learning-supplement"><strong>{visibleSupplement.question}</strong><p>{visibleSupplement.helperText}</p><span>来自链路1理解补充</span></aside>}
        <section className="live-learning-check"><h2>{source.question ?? '这一段的核心知识是什么？'}</h2>{answerOpen ? <p>{source.answer ?? node.goal}</p> : <button onClick={() => setAnswerOpen(true)} type="button">查看答案</button>}<small>问题与答案来自链路2审核通过的知识点</small></section>
      </main>
      <footer className="knowledge-learning-footer"><button onClick={() => setAnswerOpen(true)} type="button">知识检查</button><button onClick={finishNode} type="button">{stageIndex === path.stages.length - 1 && nodeIndex === nodes.length - 1 ? '完成学习' : '下一个知识点'}</button></footer>
    </div>
  )
}
