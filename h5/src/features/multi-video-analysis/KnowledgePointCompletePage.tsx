import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import './knowledgePointComplete.css'

const assetRoot = '/assets/multi-video'
const completeAssetRoot = `${assetRoot}/knowledge-complete`

interface KnowledgePointCompletePageProps {
  completedStageCount?: number
  hasNextKnowledgePoint?: boolean
  onBack: () => void
  onNext: () => void
  onReturnPath: () => void
  previousMedalPoints?: number
  medalPoints?: number
  medalTargetPoints?: number
  points?: number
  durationSeconds?: number
  accuracy?: number | null
}

interface AnimatedNumberOptions {
  delay: number
  duration: number
}

function clampValue(value: number, maximum: number) {
  return Math.min(maximum, Math.max(0, Math.round(value)))
}

function expoOut(progress: number) {
  return progress === 1 ? 1 : 1 - (2 ** (-10 * progress))
}

function useAnimatedNumber(from: number, to: number, { delay, duration }: AnimatedNumberOptions) {
  const [value, setValue] = useState(from)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setValue(to)
      return undefined
    }

    let animationFrame = 0
    let startTime = 0
    const timeout = window.setTimeout(() => {
      const animate = (time: number) => {
        if (!startTime) startTime = time
        const elapsed = Math.min(1, (time - startTime) / duration)
        const nextValue = from + ((to - from) * expoOut(elapsed))
        setValue(nextValue)
        if (elapsed < 1) animationFrame = window.requestAnimationFrame(animate)
      }
      animationFrame = window.requestAnimationFrame(animate)
    }, delay)

    return () => {
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [delay, duration, from, to])

  return value
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds < 60) return '<1分钟'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function KnowledgePointCompletePage({
  completedStageCount = 1,
  hasNextKnowledgePoint = true,
  onBack,
  onNext,
  onReturnPath,
  previousMedalPoints = 0,
  medalPoints = 0,
  medalTargetPoints = 100,
  points = 0,
  durationSeconds = 0,
  accuracy = null,
}: KnowledgePointCompletePageProps) {
  const hasCompletedKnowledge = completedStageCount > 0
  const safeMedalTarget = Math.max(1, Math.round(medalTargetPoints))
  const safePreviousMedalPoints = clampValue(previousMedalPoints, safeMedalTarget)
  const safeMedalPoints = clampValue(medalPoints, safeMedalTarget)
  const remainingMedalPoints = Math.max(0, safeMedalTarget - safeMedalPoints)
  const animatedMedalPoints = useAnimatedNumber(safePreviousMedalPoints, safeMedalPoints, { delay: 540, duration: 1050 })
  const animatedMedalProgress = (animatedMedalPoints / safeMedalTarget) * 100
  const animatedRemainingMedalPoints = Math.max(0, safeMedalTarget - Math.round(animatedMedalPoints))
  const animatedPoints = useAnimatedNumber(0, points, { delay: 1180, duration: 720 })
  const animatedDuration = useAnimatedNumber(0, durationSeconds, { delay: 1300, duration: 820 })
  const animatedAccuracy = useAnimatedNumber(0, accuracy ?? 0, { delay: 1420, duration: 720 })
  const rewards = [
    {
      className: 'points',
      icon: `${completeAssetRoot}/points-icon.svg`,
      label: '获得积分',
      value: String(Math.round(animatedPoints)),
      ariaValue: `${Math.round(animatedPoints)} 积分`,
    },
    {
      className: 'duration',
      icon: `${completeAssetRoot}/duration-icon.svg`,
      label: '学习时长',
      value: formatDuration(Math.round(animatedDuration)),
      ariaValue: `学习 ${formatDuration(Math.round(animatedDuration))}`,
    },
    {
      className: 'accuracy',
      icon: `${completeAssetRoot}/accuracy-icon.svg`,
      label: '正确率',
      value: accuracy === null ? '未测验' : `${Math.round(animatedAccuracy)}%`,
      ariaValue: accuracy === null ? '本次未完成测验' : `正确率 ${Math.round(animatedAccuracy)}%`,
    },
  ]

  return (
    <div className="learning-flow-page knowledge-complete-page">
      <img
        className="learning-flow-status knowledge-complete-status"
        src={`${assetRoot}/status-bar.svg`}
        alt="9:41，手机状态栏"
      />
      <button
        className="learning-flow-back knowledge-complete-back"
        aria-label="返回学习路径"
        onClick={onBack}
        type="button"
      >
        <img src={`${assetRoot}/flow-back.svg`} alt="" />
      </button>

      <main className="knowledge-complete-content">
        <div className="knowledge-complete-badge-stage">
          <span className="knowledge-complete-badge-halo" aria-hidden="true" />
          <img
            className="knowledge-complete-illustration"
            src={`${completeAssetRoot}/completion-illustration.png`}
            alt="星际观察员成就徽章"
          />
        </div>

        <section className="knowledge-complete-message" aria-labelledby="knowledge-complete-title">
          <h1 id="knowledge-complete-title">{hasCompletedKnowledge ? '知识点学习完成！' : '本次学习已结束'}</h1>
          <p>{hasCompletedKnowledge ? '继续保持，探索更多宇宙知识吧' : '尚未完成知识点，返回路径继续学习吧'}</p>
        </section>

        <div className="knowledge-complete-progress-copy">
          <span>勋章积分 {Math.round(animatedMedalPoints)}/{safeMedalTarget}</span>
          <strong>{animatedRemainingMedalPoints > 0 ? `还差 ${animatedRemainingMedalPoints}` : '已获得'}</strong>
        </div>
        <div
          className="knowledge-complete-progress"
          aria-label={remainingMedalPoints > 0
            ? `勋章积分 ${safeMedalPoints}/${safeMedalTarget}，距离获得勋章还差 ${remainingMedalPoints} 积分`
            : `勋章积分 ${safeMedalPoints}/${safeMedalTarget}，已达到勋章要求`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={safeMedalTarget}
          aria-valuenow={Math.round(animatedMedalPoints)}
        >
          <span style={{ transform: `scaleX(${animatedMedalProgress / 100})` }} />
        </div>

        <section className="knowledge-complete-rewards" aria-labelledby="knowledge-complete-rewards-title">
          <h2 id="knowledge-complete-rewards-title">本次学习获得</h2>
          <div className="knowledge-complete-reward-grid">
            {rewards.map((reward, index) => (
              <article
                className={`knowledge-complete-reward ${reward.className}`}
                key={reward.label}
                style={{ '--reward-delay': `${1040 + (index * 120)}ms` } as CSSProperties}
              >
                <h3>{reward.label}</h3>
                <div>
                  <img src={reward.icon} alt="" />
                  <strong aria-label={reward.ariaValue}>{reward.value}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="knowledge-complete-actions">
        <button onClick={onNext} type="button">
          {hasNextKnowledgePoint ? '学习下一个知识点' : '查看学习路径'}
        </button>
        <button onClick={onReturnPath} type="button">返回学习路径</button>
      </footer>
    </div>
  )
}
