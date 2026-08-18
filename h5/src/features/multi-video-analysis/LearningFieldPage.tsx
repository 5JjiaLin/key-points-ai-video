import { useEffect, useRef, useState } from 'react'
import type { LearningField, LearningFieldId } from './learning.types'
import './multiVideoLearning.css'

const assetRoot = '/assets/multi-video'

interface LearningFieldPageProps {
  fields: LearningField[]
  onBack: () => void
  onReview?: () => void
  onSelectField: (fieldId: LearningFieldId) => void
  showReview?: boolean
}

export function LearningFieldPage({
  fields,
  onBack,
  onReview,
  onSelectField,
  showReview = false,
}: LearningFieldPageProps) {
  const navigationTimer = useRef<number | null>(null)
  const [pressedFieldId, setPressedFieldId] = useState<LearningFieldId | null>(null)

  useEffect(() => () => {
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current)
  }, [])

  const selectField = (fieldId: LearningFieldId) => {
    if (pressedFieldId !== null) return
    setPressedFieldId(fieldId)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    navigationTimer.current = window.setTimeout(() => onSelectField(fieldId), reducedMotion ? 0 : 180)
  }

  return (
    <div className={`learning-flow-page learning-field-page ${showReview ? 'has-review' : ''}`}>
      <img className="learning-flow-status" src={`${assetRoot}/status-bar.svg`} alt="9:41，手机状态栏" />
      <button className="learning-flow-back learning-field-back" aria-label="返回个人页" onClick={onBack} type="button">
        <img src={`${assetRoot}/flow-back.svg`} alt="" />
      </button>

      <header className="learning-field-hero">
        <div>
          <h1>
            <span>你想</span>
            <span>探索哪个领域?</span>
          </h1>
          <p>选择一个感兴趣的领域开始学习</p>
        </div>
        <img src={`${assetRoot}/multi-video-ai.png`} alt="书本与放大镜组成的学习主题插图" />
      </header>

      {showReview && (
        <section className="learning-review-card" aria-labelledby="learning-review-title">
          <button className="learning-review-heading" onClick={onReview} type="button">
            <img src={`${assetRoot}/analysis-recognized-videos-icon.png`} alt="" />
            <strong id="learning-review-title">学习中心</strong>
            <span>可快速复习</span>
            <img className="learning-review-chevron" src={`${assetRoot}/field-chevron.svg`} alt="" />
          </button>

          <div className="learning-review-content">
            <img
              className="learning-review-cover"
              src={`${assetRoot}/review-black-hole-cover.webp`}
              alt="黑洞是如何形成的知识点视频片段封面"
            />
            <div className="learning-review-progress-copy">
              <strong>黑洞是如何形成的</strong>
              <div>
                <progress aria-label="学习进度 12/18" max={18} value={12} />
                <span>12/18</span>
              </div>
            </div>
            <div className="learning-review-actions">
              <button onClick={onReview} type="button">继续</button>
              <button onClick={onReview} type="button">复习</button>
            </div>
          </div>
        </section>
      )}

      <main className="learning-field-list" aria-label="学习领域">
        {fields.map((field, index) => (
          <button
            className={[
              pressedFieldId === field.id ? 'is-pressed' : '',
              pressedFieldId === null && index === 0 ? 'is-highlighted' : '',
            ].filter(Boolean).join(' ')}
            key={field.id}
            onClick={() => selectField(field.id)}
            type="button"
          >
            <img className="learning-field-icon" src={field.iconUrl} alt="" />
            <span className="learning-field-copy">
              <strong>{field.name}</strong>
              <small>{field.description}</small>
            </span>
            <img className="learning-field-chevron" src={`${assetRoot}/field-chevron.svg`} alt="" />
          </button>
        ))}
      </main>

      <p className="learning-field-hint">
        <img src={`${assetRoot}/hint-star.svg`} alt="" />
        <span>选好领域后，系统将为你推荐主题</span>
      </p>
    </div>
  )
}
