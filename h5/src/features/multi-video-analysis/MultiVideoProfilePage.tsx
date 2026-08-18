import { useEffect, useRef, useState } from 'react'
import type { MultiVideoProfileData, ProfileVideoSection } from './profile.types'
import './multiVideoProfile.css'

const assetRoot = '/assets/multi-video'

interface MultiVideoProfilePageProps {
  data: MultiVideoProfileData
  initialSectionId?: string
  onStartLearning?: () => void
}

function VideoPreviewSection({ section }: { section: ProfileVideoSection }) {
  return (
    <section className="multi-profile-video-section" aria-labelledby={`multi-profile-${section.id}`} id={`profile-section-${section.id}`}>
      <button className="multi-profile-section-heading" type="button">
        <span id={`multi-profile-${section.id}`}>{section.title}</span>
        <img src={`${assetRoot}/section-chevron.svg`} alt="" />
      </button>
      <div className="multi-profile-video-grid">
        {section.items.map((item) => (
          <article className="multi-profile-video-preview" key={item.id}>
            <div className="multi-profile-video-placeholder" aria-hidden="true" />
            <p>{item.title}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export function MultiVideoProfilePage({
  data,
  initialSectionId,
  onStartLearning,
}: MultiVideoProfilePageProps) {
  const navigationTimer = useRef<number | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => () => {
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current)
  }, [])

  useEffect(() => {
    if (!initialSectionId) return undefined
    const animationFrame = window.requestAnimationFrame(() => {
      document.getElementById(`profile-section-${initialSectionId}`)?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [initialSectionId])

  const startLearning = () => {
    if (isStarting || !onStartLearning) return
    setIsStarting(true)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    navigationTimer.current = window.setTimeout(onStartLearning, reducedMotion ? 0 : 180)
  }

  return (
    <div className={`multi-profile-page ${isStarting ? 'is-transitioning' : ''}`}>
      <img
        className="multi-profile-status-bar"
        src={`${assetRoot}/status-bar.svg`}
        alt="9:41，手机状态栏"
      />

      <main className="multi-profile-main">
        <section className="multi-profile-identity" aria-label="个人资料">
          <img className="multi-profile-avatar" src={`${assetRoot}/profile-avatar.svg`} alt="" />
          <div className="multi-profile-copy">
            <h1>{data.displayName}</h1>
            <p>抖音号：{data.accountId}</p>
          </div>
          <button className="multi-profile-home-link" type="button">
            <span>我的主页</span>
            <img src={`${assetRoot}/profile-chevron.svg`} alt="" />
          </button>
        </section>

        <section className="multi-profile-stats" aria-label="账号数据">
          {data.stats.map((stat) => (
            <div key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </section>

        <section className="multi-profile-reconstruction" aria-label="AI多视频学习重构">
          <span className="multi-profile-reconstruction-eyebrow">{data.reconstruction.eyebrow}</span>
          <div className="multi-profile-reconstruction-copy">
            <h2>{data.reconstruction.title}</h2>
            <p>{data.reconstruction.description}</p>
          </div>
          <img
            className="multi-profile-reconstruction-art"
            src={`${assetRoot}/multi-video-ai.png`}
            alt="书本与放大镜组成的学习主题插图"
          />
          <div className="multi-profile-reconstruction-actions">
            <span className="multi-profile-topic-pill">
              推荐主题:{data.reconstruction.recommendedTopic}
            </span>
            <button className={isStarting ? 'is-starting' : ''} onClick={startLearning} type="button">
              <span>{data.reconstruction.actionLabel}</span>
              <img src={`${assetRoot}/learn-arrow.svg`} alt="" />
            </button>
          </div>
        </section>

        <div className="multi-profile-library">
          {data.sections.map((section) => (
            <VideoPreviewSection key={section.id} section={section} />
          ))}
        </div>
      </main>
    </div>
  )
}
