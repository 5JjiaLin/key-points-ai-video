import { useEffect, useMemo, useRef, useState } from 'react'
import type { LearningPathViewModel } from '../../domain/learning'
import type { LearningField, LearningFieldId } from './learning.types'
import { stagesByField } from './LearningPathPage'
import './knowledgePointLearning.css'

const assetRoot = '/assets/multi-video'
const pathAssetRoot = `${assetRoot}/learning-path`

interface KnowledgePointLearningPageProps {
  field: LearningField
  initialStageIndex: number
  path?: LearningPathViewModel | null
  progressByStage?: number[]
  onBack: () => void
  onComplete: (result: KnowledgeLearningResult) => void
}

export interface KnowledgeLearningResult {
  accuracy: number | null
  completedStageIndexes: number[]
  durationSeconds: number
  points: number
  stageIndex: number
}

interface KnowledgeFragment {
  id: string
  title: string
  creator: string
  duration: string
  durationSeconds: number
  posterUrl: string
  videoUrl?: string
  startTime: number
  endTime: number
  question?: string
  answer?: string
  supplements: Array<{ question: string; helperText: string; triggerTime: number }>
}

const posterByField: Record<LearningFieldId, string> = {
  astronomy: `${assetRoot}/review-black-hole-cover.webp`,
  geography: `${pathAssetRoot}/path-bg-geography.webp`,
  history: `${pathAssetRoot}/path-bg-history.webp`,
  'life-science': `${pathAssetRoot}/path-bg-life-science.webp`,
  technology: `${pathAssetRoot}/path-bg-technology.webp`,
  economy: `${pathAssetRoot}/path-bg-economy.webp`,
  'physics-chemistry': `${pathAssetRoot}/path-bg-technology.webp`,
  'food-nutrition': `${pathAssetRoot}/path-bg-life-science.webp`,
}

const alternatePosterByField: Record<LearningFieldId, string> = {
  astronomy: `${pathAssetRoot}/path-bg-astronomy.webp`,
  geography: `${assetRoot}/field-geography.png`,
  history: `${assetRoot}/field-history.png`,
  'life-science': `${assetRoot}/field-life.png`,
  technology: `${assetRoot}/field-tech.png`,
  economy: `${assetRoot}/field-economy.png`,
  'physics-chemistry': `${assetRoot}/field-physics-chemistry-v2.png`,
  'food-nutrition': `${assetRoot}/field-food-nutrition-v2.png`,
}

const durations = [565, 408, 736, 514]
const quizPassAccuracy = 80

const quizQuestions = [
  { question: '宇宙大爆炸后，首先发生了什么？', answers: ['时间与空间开始演化', '现代星系立即形成'] },
  { question: '早期宇宙的物质为什么能够聚集？', answers: ['引力持续影响物质分布', '所有物质停止了运动'] },
  { question: '怎样获得早期宇宙演化的证据？', answers: ['观测宇宙微波背景', '直接拍摄宇宙诞生瞬间'] },
  { question: '星系形成需要经历什么过程？', answers: ['物质冷却并逐渐聚集', '行星先于恒星大量出现'] },
  { question: '对照多个片段有什么价值？', answers: ['从不同角度建立完整理解', '只记住单个结论即可'] },
]

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function buildFragments(field: LearningField, stageIndex: number, path?: LearningPathViewModel | null): KnowledgeFragment[] {
  const liveStage = path?.stages[stageIndex]
  const liveFragments = liveStage?.nodes.flatMap((node, nodeIndex) => (
    [node.source, ...node.alternatives].map((source, sourceIndex) => ({
      id: `${node.id}-${source.videoId}-${sourceIndex}`,
      title: node.title,
      creator: source.creator,
      duration: formatTime(Math.max(1, source.endTime - source.startTime)),
      durationSeconds: Math.max(1, source.endTime - source.startTime),
      posterUrl: (nodeIndex + sourceIndex) % 2 === 0 ? posterByField[field.id] : alternatePosterByField[field.id],
      videoUrl: source.videoUrl,
      startTime: source.startTime,
      endTime: source.endTime,
      question: source.question,
      answer: source.answer,
      supplements: source.supplements,
    }))
  )) ?? []
  if (liveFragments.length > 0) return liveFragments

  return Array.from({ length: 4 }, (_, index) => {
    const sourceIndex = (stageIndex + index) % field.videoTitles.length
    return {
      id: `${field.id}-${stageIndex}-${index}`,
      title: field.videoTitles[sourceIndex],
      creator: field.creators[sourceIndex % field.creators.length],
      duration: formatTime(durations[index]),
      durationSeconds: durations[index],
      posterUrl: index % 2 === 0 ? posterByField[field.id] : alternatePosterByField[field.id],
      startTime: 0,
      endTime: durations[index],
      supplements: [],
    }
  })
}

export function KnowledgePointLearningPage({
  field,
  initialStageIndex,
  path,
  progressByStage = [],
  onBack,
  onComplete,
}: KnowledgePointLearningPageProps) {
  const stageCount = Math.max(1, path?.stages.length ?? stagesByField[field.id].length)
  const [stageIndex, setStageIndex] = useState(Math.min(stageCount - 1, Math.max(0, initialStageIndex)))
  const fragments = useMemo(() => buildFragments(field, stageIndex, path), [field, path, stageIndex])
  const [activeFragmentIndex, setActiveFragmentIndex] = useState(0)
  const [isPlaying, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [quizOpen, setQuizOpen] = useState(false)
  const [quizQuestionIndex, setQuizQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<'A' | 'B' | null>(null)
  const [correctAnswerCount, setCorrectAnswerCount] = useState(0)
  const [quizAccuracyByStage, setQuizAccuracyByStage] = useState<Record<number, number>>({})
  const mediaRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const learningStartedAtRef = useRef(Date.now())
  const visitedFragmentIdsRef = useRef(new Set<string>())
  const watchedSecondsByFragmentRef = useRef(new Map<string, number>())
  const engagedStageIndexesRef = useRef(new Set<number>())
  const stage = path?.stages[stageIndex] ?? stagesByField[field.id][stageIndex]
  const activeFragment = fragments[activeFragmentIndex]
  const quizAccuracy = quizAccuracyByStage[stageIndex] ?? null
  const displayedStageProgress = Math.min(100, Math.max(0, progressByStage[stageIndex] ?? 0))
  const summary = path
    ? `${stage.description}。学习内容由所选视频的真实片段重构生成。`
    : field.id === 'astronomy' && stageIndex === 0
    ? '宇宙从一个极端高温高密度的状态开始膨胀，伴随空间的迅速扩张和物质的生成，开启了时间与空间的诞生，并为后续天体结构的形成奠定基础。'
    : `${stage.description}。通过多个视频片段对照理解，建立完整而清晰的知识联系。`

  useEffect(() => {
    if (!isPlaying || activeFragment.videoUrl) return
    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        if (time >= activeFragment.durationSeconds) {
          setPlaying(false)
          return activeFragment.durationSeconds
        }
        return time + 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [activeFragment, isPlaying])

  useEffect(() => {
    const previousSeconds = watchedSecondsByFragmentRef.current.get(activeFragment.id) ?? 0
    watchedSecondsByFragmentRef.current.set(activeFragment.id, Math.max(previousSeconds, currentTime))
  }, [activeFragment.id, currentTime])

  useEffect(() => {
    if (!videoRef.current || !activeFragment.videoUrl) return
    videoRef.current.currentTime = activeFragment.startTime
    setCurrentTime(0)
  }, [activeFragment.id, activeFragment.startTime, activeFragment.videoUrl])

  useEffect(() => {
    if (!quizOpen) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQuizOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [quizOpen])

  const markCurrentStageEngaged = () => {
    engagedStageIndexesRef.current.add(stageIndex)
    visitedFragmentIdsRef.current.add(activeFragment.id)
  }

  const togglePlayback = () => {
    if (videoRef.current && activeFragment.videoUrl) {
      if (videoRef.current.paused) void videoRef.current.play()
      else videoRef.current.pause()
      return
    }
    setPlaying((playing) => {
      if (!playing) markCurrentStageEngaged()
      return !playing
    })
  }

  const selectFragment = (index: number) => {
    setActiveFragmentIndex(index)
    setCurrentTime(0)
    setPlaying(false)
  }

  const goToNextStage = () => {
    setStageIndex((index) => Math.min(stageCount - 1, index + 1))
    setActiveFragmentIndex(0)
    setCurrentTime(0)
    setPlaying(false)
  }

  const openQuiz = () => {
    setQuizQuestionIndex(0)
    setSelectedAnswer(null)
    setCorrectAnswerCount(0)
    setQuizOpen(true)
  }

  const goToNextQuestion = () => {
    if (selectedAnswer === null) return
    const nextCorrectAnswerCount = correctAnswerCount + (selectedAnswer === 'A' ? 1 : 0)
    if (quizQuestionIndex === quizQuestions.length - 1) {
      const nextAccuracy = Math.round((nextCorrectAnswerCount / quizQuestions.length) * 100)
      setQuizAccuracyByStage((current) => ({ ...current, [stageIndex]: nextAccuracy }))
      if (nextAccuracy >= quizPassAccuracy) engagedStageIndexesRef.current.add(stageIndex)
      setQuizOpen(false)
      return
    }
    setCorrectAnswerCount(nextCorrectAnswerCount)
    setQuizQuestionIndex((index) => index + 1)
    setSelectedAnswer(null)
  }

  const quizQuestion = quizQuestions[quizQuestionIndex]
  const isLastStage = stageIndex === stageCount - 1

  const completeLearning = () => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - learningStartedAtRef.current) / 1000))
    const watchedSeconds = [...watchedSecondsByFragmentRef.current.values()]
      .reduce((total, seconds) => total + seconds, 0)
    const quizAccuracies = Object.values(quizAccuracyByStage)
    const overallQuizAccuracy = quizAccuracies.length === 0
      ? null
      : Math.round(quizAccuracies.reduce((total, value) => total + value, 0) / quizAccuracies.length)
    const correctQuestionCount = quizAccuracies.reduce(
      (total, value) => total + Math.round((value / 100) * quizQuestions.length),
      0,
    )
    const points = overallQuizAccuracy !== null && overallQuizAccuracy >= quizPassAccuracy
      ? Math.min(100, (visitedFragmentIdsRef.current.size * 10) + (correctQuestionCount * 12))
      : 0
    const completedStageIndexes = [...engagedStageIndexesRef.current]
      .filter((index) => index >= 0 && index < stageCount)
      .sort((left, right) => left - right)

    onComplete({
      accuracy: overallQuizAccuracy,
      completedStageIndexes,
      durationSeconds: Math.max(elapsedSeconds, Math.round(watchedSeconds)),
      points,
      stageIndex,
    })
  }

  return (
    <div className="learning-flow-page knowledge-learning-page">
      <img className="learning-flow-status knowledge-learning-status" src={`${assetRoot}/status-bar.svg`} alt="9:41，手机状态栏" />
      <button className="learning-flow-back knowledge-learning-back" aria-label="返回学习路径" onClick={onBack} type="button">
        <img src={`${assetRoot}/flow-back.svg`} alt="" />
      </button>
      <header className="knowledge-learning-header"><h1>知识点学习</h1></header>

      <main className="knowledge-learning-content">
        <section className="knowledge-learning-summary" aria-labelledby="knowledge-learning-title">
          <div>
            <h2 id="knowledge-learning-title">{stage.title}</h2>
            <span>{path?.stages[stageIndex]?.nodes.length ?? 1}个知识点</span>
          </div>
          <strong>{displayedStageProgress}%</strong>
          <p>{summary}</p>
        </section>

        <section className="knowledge-fragment-section" aria-labelledby="knowledge-fragment-title">
          <h2 id="knowledge-fragment-title">讲解片段</h2>
          <div className="knowledge-main-fragment" aria-label={`当前知识片段：${activeFragment.title}`} ref={mediaRef}>
            {activeFragment.videoUrl ? (
              <video
                controls
                ref={videoRef}
                onLoadedMetadata={(event) => { event.currentTarget.currentTime = activeFragment.startTime }}
                onPause={() => setPlaying(false)}
                onPlay={() => {
                  markCurrentStageEngaged()
                  setPlaying(true)
                }}
                onTimeUpdate={(event) => {
                  const absoluteTime = event.currentTarget.currentTime
                  if (absoluteTime >= activeFragment.endTime) {
                    event.currentTarget.pause()
                    event.currentTarget.currentTime = activeFragment.endTime
                  }
                  setCurrentTime(Math.max(0, Math.min(activeFragment.durationSeconds, absoluteTime - activeFragment.startTime)))
                }}
                poster={activeFragment.posterUrl}
                src={activeFragment.videoUrl}
              />
            ) : (
              <img src={activeFragment.posterUrl} alt={`${activeFragment.title}片段封面`} />
            )}
            {!activeFragment.videoUrl && (
              <button className={`knowledge-main-play ${isPlaying ? 'playing' : ''}`} aria-label={isPlaying ? '暂停片段' : '播放片段'} onClick={togglePlayback} type="button">
                <img src="/assets/knowledge-sheet-play.svg" alt="" />
              </button>
            )}
            <div className="knowledge-player-controls">
              <button aria-label={isPlaying ? '暂停' : '播放'} onClick={togglePlayback} type="button">
                <img src="/assets/knowledge-sheet-play.svg" alt="" />
              </button>
              <time>{formatTime(currentTime)}</time>
              <input
                aria-label="片段播放进度"
                max={activeFragment.durationSeconds}
                min={0}
                onChange={(event) => {
                  const nextTime = Number(event.target.value)
                  if (nextTime > 0) markCurrentStageEngaged()
                  if (videoRef.current && activeFragment.videoUrl) videoRef.current.currentTime = activeFragment.startTime + nextTime
                  setCurrentTime(nextTime)
                }}
                type="range"
                value={currentTime}
              />
              <time>{activeFragment.duration}</time>
              <button aria-label="全屏播放" onClick={() => void mediaRef.current?.requestFullscreen?.()} type="button">
                <img src="/assets/player-fullscreen.svg" alt="" />
              </button>
            </div>
          </div>

          <div className="knowledge-fragment-list" aria-label="相关知识点片段">
            {fragments.map((fragment, index) => (
              <button
                aria-pressed={index === activeFragmentIndex}
                className={index === activeFragmentIndex ? 'active' : ''}
                key={fragment.id}
                onClick={() => selectFragment(index)}
                type="button"
              >
                <span className="knowledge-fragment-cover">
                  <img src={fragment.posterUrl} alt="" />
                  <img src="/assets/knowledge-sheet-play.svg" alt="" />
                </span>
                <span className="knowledge-fragment-copy">
                  <strong>{fragment.title}</strong>
                  <small>{fragment.creator}<i />{fragment.duration}</small>
                </span>
              </button>
            ))}
          </div>
          {activeFragment.supplements[0] && (
            <aside className="knowledge-source-note">
              <strong>{activeFragment.supplements[0].question}</strong>
              <p>{activeFragment.supplements[0].helperText}</p>
              <span>来自链路1理解补充</span>
            </aside>
          )}
          {(activeFragment.question || activeFragment.answer) && (
            <aside className="knowledge-source-note">
              <strong>{activeFragment.question ?? '本段知识点'}</strong>
              <p>{activeFragment.answer ?? stage.description}</p>
              <span>来自链路2审核知识点</span>
            </aside>
          )}
        </section>
      </main>

      <footer className="knowledge-learning-footer">
        <button onClick={openQuiz} type="button">{quizAccuracy === null ? '测一测' : `已测 ${quizAccuracy}%`}</button>
        <button onClick={isLastStage ? completeLearning : goToNextStage} type="button">
          {isLastStage ? '完成' : '下一个知识点'}
        </button>
      </footer>

      {quizOpen && (
        <div className="knowledge-quiz-backdrop" role="presentation" onClick={() => setQuizOpen(false)}>
          <section aria-labelledby="knowledge-quiz-title" aria-modal="true" className="knowledge-quiz-sheet" onClick={(event) => event.stopPropagation()} role="dialog">
            <header className="knowledge-quiz-meta">
              <span id="knowledge-quiz-title">测一测</span>
              <span aria-live="polite">{quizQuestionIndex + 1}/{quizQuestions.length}</span>
            </header>
            <div className="knowledge-quiz-question">
              <h2>{quizQuestion.question}</h2>
              <p
                aria-live="polite"
                className={selectedAnswer === null ? '' : selectedAnswer === 'A' ? 'correct' : 'incorrect'}
              >
                {selectedAnswer === null
                  ? '请选择答案，提交后会立即反馈'
                  : selectedAnswer === 'A'
                    ? '回答正确，理解得很扎实！'
                    : '回答错误，正确答案是 A，请留意关键概念'}
              </p>
            </div>
            <div className="knowledge-quiz-options">
              {quizQuestion.answers.map((answer, index) => {
                const label = index === 0 ? 'A' : 'B'
                const selected = selectedAnswer === label
                const answered = selectedAnswer !== null
                const correct = answered && label === 'A'
                const incorrect = answered && selected && label !== 'A'
                return (
                  <button
                    aria-pressed={selected}
                    className={[
                      selected ? 'selected' : '',
                      correct ? 'correct' : '',
                      incorrect ? 'incorrect' : '',
                    ].filter(Boolean).join(' ')}
                    disabled={answered}
                    key={answer}
                    onClick={() => setSelectedAnswer(label as 'A' | 'B')}
                    type="button"
                  >
                    <strong>{label}</strong>
                    <span>{answer}</span>
                  </button>
                )
              })}
            </div>
            <button className="knowledge-quiz-next" disabled={selectedAnswer === null} onClick={goToNextQuestion} type="button">
              {quizQuestionIndex === quizQuestions.length - 1 ? '完成' : '下一题'}
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
