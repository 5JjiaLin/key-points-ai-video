import { useEffect, useMemo, useRef, useState } from 'react'
import type { UnderstandingSupplement, VideoKnowledgePoint, VideoProject } from './domain/video'
import type { KnowledgePoolItem, LearningPathViewModel, ReconstructionStatus } from './domain/learning'
import { createTimelineSnapshot } from './features/timeline'
import { AIReconstructionPage } from './features/multi-video-analysis/AIReconstructionPage'
import { KnowledgePointCompletePage } from './features/multi-video-analysis/KnowledgePointCompletePage'
import { KnowledgePointLearningPage } from './features/multi-video-analysis/KnowledgePointLearningPage'
import { LearningFieldPage } from './features/multi-video-analysis/LearningFieldPage'
import { LearningPathPage, stagesByField } from './features/multi-video-analysis/LearningPathPage'
import { LearningSelectionPage } from './features/multi-video-analysis/LearningSelectionPage'
import { MultiVideoProfilePage } from './features/multi-video-analysis/MultiVideoProfilePage'
import { ResearchQuestionPage } from './features/multi-video-analysis/ResearchQuestionPage'
import { multiVideoLearningFixture } from './features/multi-video-analysis/learning.fixture'
import type { CreatorCollection, LearningFieldId, LearningVideo } from './features/multi-video-analysis/learning.types'
import { multiVideoProfileFixture } from './features/multi-video-analysis/profile.fixture'
import {
  getShowcase,
  retryJob,
  uploadDouyinVideo as submitDouyinVideo,
  uploadVideo as submitVideo,
  waitForJob,
  type AnalysisJobStatus,
} from './services/backendVideoAnalysisAdapter'
import {
  adaptLearningPath,
  adaptRecommendedQuestions,
  addToKnowledgePool,
  getKnowledgePool,
  getReconstructionResult,
  getReconstructionStatus,
  removeFromKnowledgePool,
  startReconstruction,
  startReconstructionPath,
} from './services/chain3Adapter'

type BottomTab = '首页' | '放映厅' | '消息' | '我'

interface VideoCardProps {
  className?: string
  image: string
  imageClassName?: string
  title: string
  creator?: string
  avatar?: string
  reward?: boolean
  showMore?: boolean
  onOpen: () => void
}

interface PlayerPanelProps {
  addedToPool: boolean
  isActive: boolean
  onAddToPool: (projectId: string) => Promise<void>
  onBack: () => void
  onOpenPool: (category?: string) => void
  onRemoveFromPool: (projectId: string) => Promise<void>
  shouldPreload: boolean
  project: VideoProject
}

interface ActionButtonProps {
  icon: string
  label: string
  ariaLabel: string
}

function VideoCard({
  className = '',
  image,
  imageClassName = '',
  title,
  creator,
  avatar,
  reward,
  showMore,
  onOpen,
}: VideoCardProps) {
  return (
    <article className={`video-card ${className}`}>
      <button
        className={`cover-button ${imageClassName}`}
        aria-label={`播放：${title}`}
        onClick={onOpen}
        type="button"
      >
        <img className="cover-image" src={image} alt="" />
      </button>
      <h2>{title}</h2>
      {creator ? (
        <div className={`creator-row ${reward ? 'reward-row' : ''}`}>
          {reward ? <span className="reward-badge">兑好礼</span> : <img className="avatar" src={avatar} alt="" />}
          <span>{creator}</span>
          {showMore && <img className="more" src="/assets/more.svg" alt="更多" />}
        </div>
      ) : null}
    </article>
  )
}

function BottomNavigation({
  active,
  onNavigate,
  onUploadVideo,
  onUploadDouyin,
}: {
  active: BottomTab
  onNavigate: (tab: BottomTab) => void
  onUploadVideo: (file: File) => void
  onUploadDouyin: (sourceText: string) => void
}) {
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [douyinSourceText, setDouyinSourceText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tabs: BottomTab[] = ['首页', '放映厅', '消息', '我']

  return (
    <nav className="bottom-navigation" aria-label="主导航">
      {tabs.slice(0, 2).map((tab) => (
        <button
          className={active === tab ? 'active' : ''}
          key={tab}
          onClick={() => onNavigate(tab)}
          type="button"
        >
          {tab}
        </button>
      ))}
      <button
        className="create-button"
        aria-label="添加视频"
        onClick={() => setSourcePickerOpen(true)}
        type="button"
      >
        <span><img src="/assets/plus.svg" alt="" /></span>
      </button>
      <input
        ref={fileInputRef}
        className="video-file-input"
        accept="video/*"
        aria-label="选择要上传的视频"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onUploadVideo(file)
          event.target.value = ''
        }}
        type="file"
      />
      {tabs.slice(2).map((tab) => (
        <button
          className={active === tab ? 'active' : ''}
          key={tab}
          onClick={() => onNavigate(tab)}
          type="button"
        >
          {tab}
        </button>
      ))}
      {sourcePickerOpen && (
        <div
          className="video-source-backdrop"
          onClick={() => setSourcePickerOpen(false)}
          role="presentation"
        >
          <section
            aria-label="添加视频"
            aria-modal="true"
            className="video-source-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2>添加视频</h2>
            <button
              className="video-source-local"
              onClick={() => {
                setSourcePickerOpen(false)
                fileInputRef.current?.click()
              }}
              type="button"
            >
              从手机选择视频
            </button>
            <div className="video-source-divider"><span>或</span></div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const value = douyinSourceText.trim()
                if (!value) return
                setSourcePickerOpen(false)
                setDouyinSourceText('')
                onUploadDouyin(value)
              }}
            >
              <label htmlFor="douyin-source">抖音链接或分享文案</label>
              <textarea
                id="douyin-source"
                onChange={(event) => setDouyinSourceText(event.target.value)}
                placeholder="粘贴抖音链接或整段分享文案"
                rows={3}
                value={douyinSourceText}
              />
              <button className="video-source-submit" disabled={!douyinSourceText.trim()} type="submit">
                开始解析
              </button>
            </form>
            <button className="video-source-cancel" onClick={() => setSourcePickerOpen(false)} type="button">
              取消
            </button>
          </section>
        </div>
      )}
    </nav>
  )
}

function ActionButton({ icon, label, ariaLabel }: ActionButtonProps) {
  return (
    <button className="player-action" aria-label={ariaLabel} type="button">
      <img src={icon} alt="" />
      <span>{label}</span>
    </button>
  )
}

function formatTime(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(wholeSeconds / 60)
  const remainder = wholeSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function formatKnowledgeTime(seconds: number) {
  const [minutes, remainder] = formatTime(seconds).split(':')
  return `${minutes}分${remainder}秒`
}

function SupplementCardContent({ supplement }: { supplement: UnderstandingSupplement }) {
  if (supplement.type === 'claim_verification') {
    const isClarification = supplement.cardVariant === 'viewpoint_clarification'
      && supplement.leftColumn !== undefined
      && supplement.rightColumn !== undefined
    const cardVariant = isClarification ? 'viewpoint_clarification' : 'verification_result'
    const leftColumn = isClarification
      ? supplement.leftColumn!
      : { title: '待核验说法', content: supplement.sourceText }
    const rightColumn = isClarification
      ? supplement.rightColumn!
      : { title: supplement.answerLabel ?? '核验结论', content: supplement.answer }

    return (
      <div className="viewpoint-template" data-card-variant={cardVariant}>
        <span className="viewpoint-template-label">说法核验</span>
        <strong>{supplement.question}</strong>
        <p className="viewpoint-template-helper">{supplement.helperText}</p>
        <div className="viewpoint-columns">
          <section className="viewpoint-column viewpoint-column-left">
            <h4>{leftColumn.title}</h4>
            <p>{leftColumn.content}</p>
          </section>
          <section className="viewpoint-column viewpoint-column-right">
            <h4>{rightColumn.title}</h4>
            <p>{rightColumn.content}</p>
          </section>
        </div>
      </div>
    )
  }

  if (supplement.cardImageUrl) {
    const isFigmaSource = supplement.cardImageUrl.includes('supplement-card-source')

    return (
      <img
        className={isFigmaSource ? 'source-crop' : 'generated-card'}
        src={supplement.cardImageUrl}
        alt={supplement.question}
      />
    )
  }

  return (
    <div className="supplement-template">
      <span className="supplement-template-label">
        {supplement.answerLabel ?? (supplement.type === 'knowledge_gap' ? '知识补充' : '事实核查')}
      </span>
      <strong>{supplement.question}</strong>
      <p>{supplement.answer}</p>
    </div>
  )
}

function KnowledgeSheet({
  addedToPool,
  currentTime,
  knowledgePoints,
  onAddToPool,
  onClose,
  onOpenPool,
  onRemoveFromPool,
  onSeek,
}: {
  addedToPool: boolean
  currentTime: number
  knowledgePoints: VideoKnowledgePoint[]
  onAddToPool: () => Promise<void>
  onClose: () => void
  onOpenPool: () => void
  onRemoveFromPool: () => Promise<void>
  onSeek: (seconds: number) => void
}) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [showAddedToast, setShowAddedToast] = useState(false)
  const [poolPending, setPoolPending] = useState(false)
  const unviewedCount = knowledgePoints.filter((item) => item.startTime > currentTime).length

  useEffect(() => {
    if (!showAddedToast) return
    const timeout = window.setTimeout(() => setShowAddedToast(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [showAddedToast])

  const toggleAdded = async () => {
    if (poolPending) return
    setPoolPending(true)
    if (addedToPool) {
      try {
        await onRemoveFromPool()
        setShowAddedToast(false)
      } finally {
        setPoolPending(false)
      }
      return
    }
    try {
      await onAddToPool()
      setShowAddedToast(true)
    } finally {
      setPoolPending(false)
    }
  }

  return (
    <>
      <button
        className="knowledge-sheet-dismiss"
        aria-label="收起知识点"
        onClick={onClose}
        type="button"
      />
      <section className="knowledge-sheet" aria-label="知识点列表" role="dialog" aria-modal="true">
        <span className="knowledge-sheet-handle" aria-hidden="true" />
        <header className="knowledge-sheet-header">
          <div className="knowledge-sheet-header-row">
            <h2>知识点</h2>
            <button
              className="knowledge-sheet-add"
              disabled={poolPending}
              onClick={() => void toggleAdded()}
              type="button"
            >
              {addedToPool ? '取消' : '添加'}
            </button>
          </div>
          <p>
            本视频知识&nbsp; {knowledgePoints.length} 个知识点 ·&nbsp;
            <strong>{unviewedCount}个未查看</strong>
          </p>
        </header>
        <ol className="knowledge-sheet-list">
          {knowledgePoints.map((item) => {
            const isExpanded = expandedItem === item.id
            const isCurrent = currentTime >= item.startTime && currentTime <= item.endTime

            return (
              <li className={`${isCurrent ? 'current' : ''} ${isExpanded ? 'expanded' : ''}`} key={item.id}>
                <div className="knowledge-sheet-meta">
                  <time>{formatKnowledgeTime(item.startTime)}</time>
                  <button
                    className="knowledge-sheet-clip"
                    aria-label={`播放关键片段：${item.question}`}
                    onClick={() => onSeek(item.startTime)}
                    type="button"
                  >
                    关键片段
                    <img src="/assets/knowledge-sheet-play.svg" alt="" />
                  </button>
                </div>
                <button
                  className="knowledge-sheet-entry"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                  type="button"
                >
                  <span className="knowledge-sheet-copy">
                    <strong>{item.question}</strong>
                  </span>
                  <span className="knowledge-sheet-expand">
                    {isExpanded ? '收起' : '展开'}
                    <img className={isExpanded ? 'expanded' : ''} src="/assets/knowledge-sheet-detail-chevron.svg" alt="" />
                  </span>
                </button>
                {isExpanded && <p className="knowledge-sheet-answer">{item.answer}</p>}
              </li>
            )
          })}
        </ol>
      </section>
      {showAddedToast && (
        <button className="knowledge-added-toast" aria-live="polite" onClick={onOpenPool} type="button">
          <span className="knowledge-added-toast-message">
            <img src="/assets/knowledge-added-check.svg" alt="" />
            <span>已添加到划重点</span>
          </span>
          <img className="knowledge-added-toast-chevron" src="/assets/knowledge-added-chevron.svg" alt="" />
        </button>
      )}
    </>
  )
}

function ChainHint({
  supplement,
  onOpen,
}: {
  supplement: UnderstandingSupplement
  onOpen: () => void
}) {
  return (
    <button
      className="chain-one-hint"
      aria-label="查看链路1识别结果"
      onClick={onOpen}
      type="button"
    >
      <span className="chain-one-hint-thumbnail">
        {supplement.hintStickerImageUrl && (
          <img
            src={supplement.hintStickerImageUrl}
            alt={`${supplement.question}的提示贴图`}
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        )}
      </span>
      <div className="chain-one-hint-copy">
        <strong>{supplement.question}</strong>
        <span>{supplement.helperText}</span>
      </div>
      <img className="chain-one-hint-chevron" src="/assets/chain-one-hint-chevron.svg" alt="" />
    </button>
  )
}

function ChainOneResultCard({
  supplement,
  onClose,
}: {
  supplement: UnderstandingSupplement
  onClose: () => void
}) {
  return (
    <aside className="chain-one-result-card" aria-label="链路1识别结果">
      <div className="chain-one-result-content">
        <SupplementCardContent supplement={supplement} />
      </div>
      <button className="chain-one-result-close" aria-label="关闭识别结果" onClick={onClose} type="button">
        <img src="/assets/chain-one-card-close.svg" alt="" />
      </button>
    </aside>
  )
}

function PlayerPanel({
  addedToPool,
  isActive,
  onAddToPool,
  onBack,
  onOpenPool,
  onRemoveFromPool,
  project,
  shouldPreload,
}: PlayerPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasPlayableVideo = project.videoUrl.startsWith('blob:') || project.videoUrl.includes('/api/media/')
  const [currentTime, setCurrentTime] = useState(hasPlayableVideo ? 0 : 36.1)
  const [selectedSupplement, setSelectedSupplement] = useState<UnderstandingSupplement | null>(null)
  const [handledSupplementIds, setHandledSupplementIds] = useState<Set<string>>(() => new Set())
  const [showKnowledgeSheet, setShowKnowledgeSheet] = useState(false)
  const snapshot = useMemo(
    () => createTimelineSnapshot(project, currentTime),
    [currentTime, project],
  )
  const activeSupplement = snapshot.activeSupplement && !handledSupplementIds.has(snapshot.activeSupplement.id)
    ? snapshot.activeSupplement
    : undefined
  const closeSupplement = () => {
    setSelectedSupplement(null)
  }
  const openKnowledgeSheet = () => {
    setSelectedSupplement(null)
    setShowKnowledgeSheet(true)
  }
  const seekToKnowledgePoint = (seconds: number) => {
    setCurrentTime(seconds)
    const video = videoRef.current
    if (!video) return
    video.currentTime = seconds
    if (isActive) void video.play().catch(() => undefined)
  }

  useEffect(() => {
    if (hasPlayableVideo) return

    const clock = window.setInterval(() => {
      setCurrentTime((time) => (time >= project.duration ? 0 : time + 0.25))
    }, 250)

    return () => window.clearInterval(clock)
  }, [hasPlayableVideo, project.duration])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!isActive) {
      video.pause()
      video.currentTime = 0
      setCurrentTime(0)
      setSelectedSupplement(null)
      setShowKnowledgeSheet(false)
      return
    }
    video.currentTime = 0
    video.muted = true
    void video.play().catch(() => undefined)
  }, [isActive])

  useEffect(() => {
    if (!showKnowledgeSheet && !selectedSupplement) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowKnowledgeSheet(false)
        closeSupplement()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showKnowledgeSheet, selectedSupplement])

  return (
    <article
      className="player-page"
      data-video-id={project.id}
      data-current-time={currentTime.toFixed(2)}
      data-chain1-items={project.supplements.length}
      data-chain2-items={project.knowledgePoints.length}
    >
      <img className="player-status-bar" src="/assets/player-status.svg" alt="9:41，手机状态栏" />

      <div className="player-topbar">
        <button
          className="player-back"
          aria-label={selectedSupplement ? '关闭识别结果' : '返回首页'}
          onClick={selectedSupplement ? closeSupplement : onBack}
          type="button"
        >
          <img src="/assets/player-back.svg" alt="" />
        </button>
        <button className="player-search-box" aria-label="搜索冰水" type="button">
          <span className="player-search-query">
            <img src="/assets/player-search-small.svg" alt="" />
            冰水
          </span>
          <span className="player-search-submit">
            <img src="/assets/player-divider.svg" alt="" />
            搜索
          </span>
        </button>
        <div className="player-top-actions">
          <button aria-label="听视频" type="button"><img src="/assets/player-headphones.svg" alt="" /></button>
          <button className="player-ai-action" aria-label="询问 AI" type="button"><img src="/assets/player-ai.svg" alt="" /></button>
          <button aria-label="查看知识点" onClick={openKnowledgeSheet} type="button">
            <img src="/assets/player-knowledge.png" alt="" />
          </button>
        </div>
      </div>

      {hasPlayableVideo ? (
        <video
          ref={videoRef}
          className="video-stage"
          aria-label={`正在播放：${project.title}`}
          controls
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          playsInline
          preload={shouldPreload ? 'metadata' : 'none'}
          src={shouldPreload ? project.videoUrl : undefined}
        />
      ) : (
        <div className="video-stage" role="img" aria-label="视频播放区域" />
      )}
      <button className="fullscreen-watch" type="button">全屏观看</button>
      {activeSupplement && (
        <ChainHint
          supplement={activeSupplement}
          onOpen={() => {
            setHandledSupplementIds((ids) => new Set(ids).add(activeSupplement.id))
            setShowKnowledgeSheet(false)
            setSelectedSupplement(activeSupplement)
          }}
        />
      )}

      <aside className="player-action-rail" aria-label="视频操作">
        <ActionButton icon="/assets/player-heart.svg" label="7.1万" ariaLabel="喜欢" />
        <ActionButton icon="/assets/player-comment.svg" label="7.1万" ariaLabel="评论" />
        <ActionButton icon="/assets/player-like.svg" label="7.1万" ariaLabel="点赞" />
        <ActionButton icon="/assets/player-star.svg" label="7.1万" ariaLabel="收藏" />
        <ActionButton icon="/assets/player-later.svg" label="稍后再看" ariaLabel="稍后再看" />
      </aside>

      <div className="player-content-layer">
        <button className="bullet-entry" aria-label="打开弹幕" type="button">弹</button>

        <section className="player-author-block">
          <div className="player-author-row">
            <img src="/assets/player-avatar.svg" alt="" />
            <span>{project.creator}</span>
            <button type="button">关注</button>
          </div>
          <p className="player-description">{project.title}｜链路1与链路2 Harness 联调 Demo</p>
        </section>

        <p className="ai-disclaimer">作者声明：内容由AI生成</p>
        <div className="player-divider-line" />
        <div className="player-collection-row">
          <button className="player-collection" type="button">合集·《地球那些事》</button>
          <button className="player-round-action" aria-label="分享" type="button">
            <img src="/assets/player-share.svg" alt="" />
          </button>
          <button className="player-round-action" aria-label="展开" type="button">
            <img src="/assets/player-fullscreen.svg" alt="" />
          </button>
        </div>
      </div>

      {selectedSupplement && (
        <ChainOneResultCard
          supplement={selectedSupplement}
          onClose={closeSupplement}
        />
      )}
      {showKnowledgeSheet && (
        <KnowledgeSheet
          addedToPool={addedToPool}
          currentTime={currentTime}
          knowledgePoints={project.knowledgePoints}
          onAddToPool={() => onAddToPool(project.id)}
          onClose={() => setShowKnowledgeSheet(false)}
          onOpenPool={() => onOpenPool(project.category)}
          onRemoveFromPool={() => onRemoveFromPool(project.id)}
          onSeek={seekToKnowledgePoint}
        />
      )}
    </article>
  )
}

function PlayerFeedPage({
  poolIds,
  onAddToPool,
  onBack,
  onOpenPool,
  onRemoveFromPool,
  projects,
}: {
  poolIds: Set<string>
  onAddToPool: (projectId: string) => Promise<void>
  onBack: () => void
  onOpenPool: (category?: string) => void
  onRemoveFromPool: (projectId: string) => Promise<void>
  projects: VideoProject[]
}) {
  const feedRef = useRef<HTMLElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const root = feedRef.current
    if (!root) return
    const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-video-id]'))
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (!visible) return
      const nextIndex = panels.indexOf(visible.target as HTMLElement)
      if (nextIndex >= 0) setActiveIndex(nextIndex)
    }, { root, threshold: [0.55, 0.75] })
    panels.forEach((panel) => observer.observe(panel))
    return () => observer.disconnect()
  }, [projects])

  return (
    <main className="player-feed" ref={feedRef} aria-label="视频连续播放列表">
      {projects.map((project, index) => (
        <PlayerPanel
          addedToPool={poolIds.has(project.id)}
          isActive={index === activeIndex}
          key={project.id}
          onAddToPool={onAddToPool}
          onBack={onBack}
          onOpenPool={onOpenPool}
          onRemoveFromPool={onRemoveFromPool}
          project={project}
          shouldPreload={Math.abs(index - activeIndex) <= 1}
        />
      ))}
    </main>
  )
}

function UploadProcessing({
  status,
  error,
  onRetry,
  onClose,
  onBrowseVideos,
}: {
  status: AnalysisJobStatus | null
  error: { message: string; retryable: boolean } | null
  onRetry: () => void
  onClose: () => void
  onBrowseVideos: () => void
}) {
  const progress = Math.round((status?.progress ?? 0) * 100)
  return (
    <div className="upload-processing-backdrop">
      <section className="upload-processing" aria-label={error ? '视频解析失败' : '视频解析中'} aria-live="polite" role="status">
        {!error && <span className="upload-spinner" aria-hidden="true" />}
        <strong>{error ? '视频解析失败' : '视频正在解析'}</strong>
        <p>{status?.originalName}</p>
        {error ? (
          <>
            <small>{error.message}</small>
            <div className="upload-processing-actions">
              {error.retryable && <button onClick={onRetry} type="button">重试解析</button>}
              <button onClick={onClose} type="button">关闭</button>
            </div>
          </>
        ) : (
          <>
            <small>{progress}% · 解析期间可以先看其他视频</small>
            <div className="upload-processing-actions">
              <button onClick={onBrowseVideos} type="button">先看其他视频</button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function HomePage({
  onOpenVideo,
  analysisStatus,
  analysisError,
  onRetryAnalysis,
  onCloseAnalysis,
  onBrowseVideos,
}: {
  onOpenVideo: () => void
  analysisStatus: AnalysisJobStatus | null
  analysisError: { message: string; retryable: boolean } | null
  onRetryAnalysis: () => void
  onCloseAnalysis: () => void
  onBrowseVideos: () => void
}) {
  return (
    <>
      <header>
        <img className="status-bar" src="/assets/status-bar.svg" alt="9:41，手机状态栏" />
        <div className="channel-navigation" aria-label="频道导航">
          <img src="/assets/top-tabs.png" alt="热门、推荐、关注；当前为推荐" />
        </div>
      </header>

      <main className="feed" aria-label="推荐视频">
        <div className="home-feed-content">
          <VideoCard
            className="home-card home-card-capital"
            image="/assets/capital-logic.png"
            title="马克思 《资本论》第一期：商品货币流通的基本逻辑"
            creator="听风电影笔记"
            avatar="/assets/avatar-listening.svg"
            showMore
            onOpen={onOpenVideo}
          />
          <VideoCard
            className="home-card home-card-ice"
            image="/assets/ice-water.png"
            title="喝冰水伤胃吗？ 冰水背了多少年的锅？"
            creator="听风电影笔记"
            avatar="/assets/avatar-listening.svg"
            showMore
            onOpen={onOpenVideo}
          />
          <VideoCard
            className="home-card home-card-milk"
            image="/assets/economics-milk.png"
            title="5个经济学冷知识：一瓶牛奶可乐带你看懂世界运转逻辑..."
            creator="听风电影笔记"
            avatar="/assets/avatar-gray.svg"
            showMore
            onOpen={onOpenVideo}
          />
          <VideoCard
            className="home-card home-card-zhang"
            image="/assets/zhang-xueliang.png"
            title="蒋介石软禁张学良54年到底花了多少钱"
            onOpen={onOpenVideo}
          />
          <VideoCard
            className="home-card home-card-hotpot-left"
            image="/assets/hotpot.png"
            title="《死亡诗社》一部被片名误导的伟大电影"
            creator="听风电影笔记"
            avatar="/assets/avatar-gray.svg"
            onOpen={onOpenVideo}
          />
          <VideoCard
            className="home-card home-card-hotpot-right"
            image="/assets/hotpot.png"
            title="《死亡诗社》一部被片名误导的伟大电影"
            creator="听风电影笔记"
            avatar="/assets/avatar-gray.svg"
            onOpen={onOpenVideo}
          />
          <VideoCard
            className="home-card home-card-hotpot-repeat"
            image="/assets/hotpot.png"
            title="《死亡诗社》一部被片名误导的伟大电影"
            creator="听风电影笔记"
            avatar="/assets/avatar-gray.svg"
            onOpen={onOpenVideo}
          />
        </div>
      </main>

      {(analysisStatus || analysisError) && (
        <UploadProcessing
          status={analysisStatus}
          error={analysisError}
          onRetry={onRetryAnalysis}
          onClose={onCloseAnalysis}
          onBrowseVideos={onBrowseVideos}
        />
      )}
    </>
  )
}

type AppRoute = 'home' | 'video' | 'profile' | 'fields' | 'selection' | 'research' | 'reconstruction' | 'path' | 'learning' | 'complete'

const MEDIUM_DEMO_JOB_ID = '9dd5ff95-0c7e-4ce5-848f-7aeaf1c866a0'

const routeHash: Record<AppRoute, string> = {
  home: '', video: '#video', profile: '#profile', fields: '#learning-fields', selection: '#learning-selection',
  research: '#research-question', reconstruction: '#ai-reconstruction', path: '#learning-path',
  learning: '#knowledge-learning', complete: '#knowledge-complete',
}

function routeFromHash(): AppRoute {
  const match = Object.entries(routeHash).find(([, hash]) => hash && window.location.hash === hash)
  return (match?.[0] as AppRoute | undefined) ?? 'home'
}

export default function App() {
  const activeJobStorageKey = 'huazhongdian.activeAnalysisJobId'
  const stableAnalysisStorageKey = 'huazhongdian.chain3StableAnalysisId'
  const pathAnalysisStorageKey = 'huazhongdian.chain3PathAnalysisId'
  const fieldStorageKey = 'huazhongdian.chain3FieldId'
  const questionStorageKey = 'huazhongdian.chain3Question'
  const selectionStorageKey = 'huazhongdian.chain3SelectedVideoIds'
  const [route, setRoute] = useState<AppRoute>(routeFromHash)
  const [showcaseProjects, setShowcaseProjects] = useState<VideoProject[]>([])
  const [temporaryProject, setTemporaryProject] = useState<VideoProject | null>(null)
  const [showcaseError, setShowcaseError] = useState<string | null>(null)
  const [poolItems, setPoolItems] = useState<KnowledgePoolItem[]>([])
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisJobStatus | null>(null)
  const [analysisError, setAnalysisError] = useState<{ message: string; retryable: boolean } | null>(null)
  const [analysisCompleted, setAnalysisCompleted] = useState(false)
  const [selectedFieldId, setSelectedFieldId] = useState<LearningFieldId>(() => {
    const stored = window.localStorage.getItem(fieldStorageKey) as LearningFieldId | null
    return multiVideoLearningFixture.fields.some((field) => field.id === stored) ? stored! : multiVideoLearningFixture.fields[0].id
  })
  const [researchQuestion, setResearchQuestion] = useState(() => window.localStorage.getItem(questionStorageKey) ?? '')
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem(selectionStorageKey) ?? '[]') as string[] }
    catch { return [] }
  })
  const [stableAnalysisId, setStableAnalysisId] = useState<string | null>(() => window.localStorage.getItem(stableAnalysisStorageKey))
  const [pathAnalysisId, setPathAnalysisId] = useState<string | null>(() => window.localStorage.getItem(pathAnalysisStorageKey))
  const [recommendedQuestions, setRecommendedQuestions] = useState<string[]>([])
  const [reconstructionStatus, setReconstructionStatus] = useState<ReconstructionStatus | null>(null)
  const [reconstructionError, setReconstructionError] = useState<string | null>(null)
  const [learningPath, setLearningPath] = useState<LearningPathViewModel | null>(null)
  const [learningStageIndex, setLearningStageIndex] = useState(0)
  const [progressByStage, setProgressByStage] = useState<number[]>(() => stagesByField[selectedFieldId].map(() => 0))
  const [completionSummary, setCompletionSummary] = useState({
    accuracy: null as number | null,
    completedStageCount: 0,
    durationSeconds: 0,
    points: 0,
  })
  const analysisAbortRef = useRef<AbortController | null>(null)
  const selectedField = multiVideoLearningFixture.fields.find((field) => field.id === selectedFieldId) ?? multiVideoLearningFixture.fields[0]
  const poolIds = useMemo(() => new Set(poolItems.map((item) => item.jobId)), [poolItems])
  const projects = useMemo(() => {
    const availableProjects = temporaryProject
      ? [temporaryProject, ...showcaseProjects.filter((item) => item.id !== temporaryProject.id)]
      : showcaseProjects
    const mediumDemo = availableProjects.find((item) => item.id === MEDIUM_DEMO_JOB_ID)
    return mediumDemo
      ? [mediumDemo, ...availableProjects.filter((item) => item.id !== MEDIUM_DEMO_JOB_ID)]
      : availableProjects
  }, [showcaseProjects, temporaryProject])
  const readyPoolProjects = useMemo(() => poolItems.flatMap((item) => item.project ? [item.project] : []), [poolItems])
  const selectionVideos = useMemo<LearningVideo[]>(() => readyPoolProjects.map((project) => ({
    id: project.id,
    title: project.title,
    creator: project.creator,
    duration: `${Math.floor(project.duration / 60)}:${String(Math.floor(project.duration % 60)).padStart(2, '0')}`,
  })), [readyPoolProjects])
  const creatorCollections = useMemo<CreatorCollection[]>(() => {
    const grouped = new Map<string, LearningVideo[]>()
    selectionVideos.forEach((video) => grouped.set(video.creator, [...(grouped.get(video.creator) ?? []), video]))
    return [...grouped.entries()].filter(([, videos]) => videos.length >= 3).map(([creator, videos]) => ({
      id: `creator-${creator}`,
      title: `${creator}系列`,
      creator,
      videos,
    }))
  }, [selectionVideos])

  const navigate = (next: AppRoute, replace = false) => {
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method]({ view: next }, '', routeHash[next] || window.location.pathname)
    setRoute(next)
  }
  const loadShowcase = async () => {
    try { const items = await getShowcase(); setShowcaseProjects(items); setShowcaseError(null); return items }
    catch (error) { setShowcaseError(error instanceof Error ? error.message : String(error)); return [] }
  }
  const loadPool = async () => {
    try { const items = await getKnowledgePool(); setPoolItems(items); return items }
    catch { return [] }
  }
  const watchJob = async (jobId: string) => {
    analysisAbortRef.current?.abort()
    const controller = new AbortController(); analysisAbortRef.current = controller; setAnalysisError(null)
    try {
      const analyzedProject = await waitForJob(jobId, (status) => { setAnalysisStatus(status); void loadPool() }, controller.signal)
      setTemporaryProject(analyzedProject); setAnalysisStatus(null); setAnalysisCompleted(true)
      window.localStorage.removeItem(activeJobStorageKey); await loadPool()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const typed = error as Error & { retryable?: boolean }; setAnalysisError({ message: typed.message, retryable: typed.retryable === true }); await loadPool()
    }
  }
  const beginUpload = async (submit: () => Promise<{ jobId: string }>, originalName: string, addToPool: boolean) => {
    setAnalysisStatus({ jobId: 'uploading', state: 'queued', progress: 0, message: '正在提交视频', retryable: false, originalName })
    setAnalysisError(null); setAnalysisCompleted(false)
    try {
      const { jobId } = await submit(); window.localStorage.setItem(activeJobStorageKey, jobId)
      if (addToPool) { await addToKnowledgePool(jobId); await loadPool() }
      await watchJob(jobId)
    } catch (error) { setAnalysisError({ message: error instanceof Error ? error.message : String(error), retryable: false }) }
  }
  const uploadVideo = (file: File, addToPool = false) => {
    if (file.type && !file.type.startsWith('video/')) return
    void beginUpload(() => submitVideo(file), file.name, addToPool)
  }
  const uploadDouyinVideo = (sourceText: string, addToPool = false) => void beginUpload(() => submitDouyinVideo(sourceText), '抖音视频', addToPool)
  const addPoolProject = async (projectId: string) => { await addToKnowledgePool(projectId); await loadPool() }
  const removePoolProject = async (projectId: string) => { await removeFromKnowledgePool(projectId); await loadPool() }
  const openKnowledgePool = (category?: string) => {
    const field = multiVideoLearningFixture.fields.find((item) => item.id === category)
    if (field) {
      setSelectedFieldId(field.id)
      setProgressByStage(stagesByField[field.id].map(() => 0))
      window.localStorage.setItem(fieldStorageKey, field.id)
      navigate('selection')
      return
    }
    navigate('profile')
  }

  useEffect(() => { const sync = () => setRoute(routeFromHash()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync) }, [])
  useEffect(() => { void loadShowcase(); void loadPool() }, [])
  useEffect(() => { const activeJobId = window.localStorage.getItem(activeJobStorageKey); if (activeJobId) void watchJob(activeJobId); return () => analysisAbortRef.current?.abort() }, [])
  useEffect(() => {
    if (!poolItems.some((item) => !item.project && item.state !== 'failed')) return
    const timer = window.setInterval(() => void loadPool(), 2000); return () => window.clearInterval(timer)
  }, [poolItems])
  useEffect(() => { if (!analysisCompleted) return; const timer = window.setTimeout(() => setAnalysisCompleted(false), 5000); return () => window.clearTimeout(timer) }, [analysisCompleted])

  useEffect(() => {
    if (!stableAnalysisId || recommendedQuestions.length > 0) return
    let cancelled = false
    let timer = 0
    const poll = async () => {
      try {
        const status = await getReconstructionStatus(stableAnalysisId)
        if (cancelled) return
        setReconstructionStatus(status)
        if (status.status === 'awaiting_question') {
          const result = await getReconstructionResult(stableAnalysisId)
          if (!cancelled) setRecommendedQuestions(adaptRecommendedQuestions(result).map((item) => item.question))
          return
        }
        if (status.status === 'failed' || status.status === 'needs_review') {
          setReconstructionError(status.error?.message ?? '视频入选或知识重构失败')
          return
        }
        timer = window.setTimeout(poll, 800)
      } catch (error) {
        if (!cancelled) setReconstructionError(error instanceof Error ? error.message : String(error))
      }
    }
    void poll()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [recommendedQuestions.length, stableAnalysisId])

  useEffect(() => {
    if (!pathAnalysisId || learningPath) return
    let cancelled = false
    let timer = 0
    const poll = async () => {
      try {
        const status = await getReconstructionStatus(pathAnalysisId)
        if (cancelled) return
        setReconstructionStatus(status)
        if (status.status === 'completed') {
          const result = await getReconstructionResult(pathAnalysisId)
          if (cancelled) return
          const path = adaptLearningPath(result, poolItems)
          setLearningPath(path)
          setProgressByStage(path.stages.map(() => 0))
          if (window.location.hash === '#ai-reconstruction') navigate('path', true)
          return
        }
        if (status.status === 'failed' || status.status === 'needs_review') {
          setReconstructionError(status.error?.message ?? '学习路径生成失败')
          return
        }
        timer = window.setTimeout(poll, 800)
      } catch (error) {
        if (!cancelled) setReconstructionError(error instanceof Error ? error.message : String(error))
      }
    }
    void poll()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [learningPath, pathAnalysisId, poolItems])

  const startStableReconstruction = async (selection: { videoIds: string[]; mode: 'multi-creator' | 'single-creator' }) => {
    setSelectedVideoIds(selection.videoIds)
    window.localStorage.setItem(selectionStorageKey, JSON.stringify(selection.videoIds))
    setRecommendedQuestions([])
    setLearningPath(null)
    setReconstructionError(null)
    setStableAnalysisId(null)
    setPathAnalysisId(null)
    window.localStorage.removeItem(stableAnalysisStorageKey)
    window.localStorage.removeItem(pathAnalysisStorageKey)
    try {
      const started = await startReconstruction({
        videoIds: selection.videoIds,
        requestedAnalysisMode: selection.mode === 'single-creator' ? 'single_creator_series' : 'multi_creator_topic',
        themeHint: selectedField.name,
      })
      setStableAnalysisId(started.analysisId)
      window.localStorage.setItem(stableAnalysisStorageKey, started.analysisId)
      navigate('research')
    } catch (error) {
      setReconstructionError(error instanceof Error ? error.message : String(error))
      navigate('research')
    }
  }

  const submitResearchQuestion = async (question: string) => {
    if (!stableAnalysisId) return
    setResearchQuestion(question)
    window.localStorage.setItem(questionStorageKey, question)
    setReconstructionError(null)
    navigate('reconstruction')
    try {
      const started = await startReconstructionPath(stableAnalysisId, question)
      setPathAnalysisId(started.analysisId)
      window.localStorage.setItem(pathAnalysisStorageKey, started.analysisId)
    } catch (error) {
      setReconstructionError(error instanceof Error ? error.message : String(error))
    }
  }
  const retryAnalysis = async (jobId = window.localStorage.getItem(activeJobStorageKey)) => {
    if (!jobId) return
    try { await retryJob(jobId); window.localStorage.setItem(activeJobStorageKey, jobId); await watchJob(jobId) }
    catch (error) { setAnalysisError({ message: error instanceof Error ? error.message : String(error), retryable: false }) }
  }
  const openPlayer = async () => { if (showcaseProjects.length === 0) await loadShowcase(); navigate('video') }
  const closeAnalysis = () => { analysisAbortRef.current?.abort(); setAnalysisStatus(null); setAnalysisError(null) }
  const closePlayer = () => window.history.back()

  let content
  if (route === 'video') content = projects.length ? <PlayerFeedPage poolIds={poolIds} onAddToPool={addPoolProject} onBack={closePlayer} onOpenPool={openKnowledgePool} onRemoveFromPool={removePoolProject} projects={projects} /> : <main className="player-feed-empty"><button onClick={closePlayer} type="button">返回首页</button><p>{showcaseError ?? '正在加载展示视频…'}</p></main>
  else if (route === 'profile') content = <MultiVideoProfilePage data={multiVideoProfileFixture} onStartLearning={() => navigate('fields')} />
  else if (route === 'fields') content = <LearningFieldPage fields={multiVideoLearningFixture.fields} onBack={() => navigate('profile')} onSelectField={(fieldId) => { setSelectedFieldId(fieldId); setProgressByStage(stagesByField[fieldId].map(() => 0)); window.localStorage.setItem(fieldStorageKey, fieldId); navigate('selection') }} />
  else if (route === 'selection') content = <LearningSelectionPage collections={creatorCollections} field={selectedField} initialSelectedVideoIds={selectedVideoIds} key={`${selectedField.id}-${selectionVideos.map((video) => video.id).join('-')}`} videos={selectionVideos} onBack={() => navigate('fields')} onNext={(selection) => void startStableReconstruction(selection)} />
  else if (route === 'research') content = <ResearchQuestionPage error={reconstructionError} field={selectedField} loading={Boolean(stableAnalysisId && recommendedQuestions.length === 0 && !reconstructionError)} recommendedQuestions={stableAnalysisId ? recommendedQuestions : undefined} onBack={() => navigate('selection')} onSubmit={(question) => void submitResearchQuestion(question)} />
  else if (route === 'reconstruction') content = reconstructionError
    ? <main className="player-feed-empty"><button onClick={() => navigate('research')} type="button">返回研究问题</button><p>{reconstructionError}</p></main>
    : <AIReconstructionPage field={selectedField} loadingVideoSrc="/assets/multi-video/ai-reconstruction-loading.mp4" progress={reconstructionStatus?.progress ?? 0} onBack={() => navigate('research')} onBrowseVideos={() => navigate('home')} onComplete={() => { if (learningPath) navigate('path', true) }} />
  else if (route === 'path') content = <LearningPathPage field={selectedField} path={learningPath} question={researchQuestion} progressByStage={progressByStage} onBack={() => navigate('profile')} onStart={(index) => { setLearningStageIndex(index); navigate('learning') }} />
  else if (route === 'learning') content = <KnowledgePointLearningPage field={selectedField} initialStageIndex={learningStageIndex} path={learningPath} progressByStage={progressByStage} onBack={() => navigate('path')} onComplete={(result) => { setProgressByStage((current) => current.map((value, index) => result.completedStageIndexes.includes(index) ? 100 : value)); setCompletionSummary({ accuracy: result.accuracy, completedStageCount: result.completedStageIndexes.length, durationSeconds: result.durationSeconds, points: result.points }); navigate('complete', true) }} />
  else if (route === 'complete') content = <KnowledgePointCompletePage accuracy={completionSummary.accuracy} completedStageCount={completionSummary.completedStageCount} durationSeconds={completionSummary.durationSeconds} hasNextKnowledgePoint={progressByStage.some((value) => value < 100)} points={completionSummary.points} onBack={() => navigate('path')} onNext={() => navigate('path')} onReturnPath={() => navigate('path')} />
  else content = <HomePage onOpenVideo={openPlayer} analysisStatus={analysisStatus} analysisError={analysisError} onRetryAnalysis={() => void retryAnalysis()} onCloseAnalysis={closeAnalysis} onBrowseVideos={() => void openPlayer()} />

  const activeTab: BottomTab = route === 'home' ? '首页' : route === 'video' ? '放映厅' : '我'
  const navigateFromTab = (tab: BottomTab) => {
    if (tab === '首页') navigate('home')
    else if (tab === '放映厅') void openPlayer()
    else if (tab === '我') navigate('profile')
  }
  const toast = analysisCompleted && <div className="analysis-complete-toast" aria-live="polite" role="status"><span>视频解析完成</span><button onClick={() => navigate('profile')} type="button">查看划重点</button></div>

  if (route === 'video') return <>{content}{toast}</>
  return (
    <div className="app-shell">
      <div className="app-content">{content}</div>
      <BottomNavigation
        active={activeTab}
        onNavigate={navigateFromTab}
        onUploadDouyin={(text) => uploadDouyinVideo(text)}
        onUploadVideo={(file) => uploadVideo(file)}
      />
      {toast}
    </div>
  )
}
