import { useEffect, useMemo, useRef, useState } from 'react'
import type { UnderstandingSupplement, VideoKnowledgePoint, VideoProject } from './domain/video'
import { createTimelineSnapshot } from './features/timeline'
import { iceWaterDemoProject } from './fixtures/iceWaterHarness'
import {
  retryJob,
  uploadVideo as submitVideo,
  waitForJob,
  type AnalysisJobStatus,
} from './services/backendVideoAnalysisAdapter'

type BottomTab = '首页' | '放映厅' | '消息' | '我'

interface VideoCardProps {
  image: string
  imageClassName?: string
  title: string
  creator?: string
  avatar?: string
  reward?: boolean
  showMore?: boolean
  onOpen: () => void
}

interface PlayerPageProps {
  onBack: () => void
  project: VideoProject
}

interface ActionButtonProps {
  icon: string
  label: string
  ariaLabel: string
}

function VideoCard({
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
    <article className="video-card">
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

function BottomNavigation({ onUploadVideo }: { onUploadVideo: (file: File) => void }) {
  const [active, setActive] = useState<BottomTab>('首页')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tabs: BottomTab[] = ['首页', '放映厅', '消息', '我']

  return (
    <nav className="bottom-navigation" aria-label="主导航">
      {tabs.slice(0, 2).map((tab) => (
        <button
          className={active === tab ? 'active' : ''}
          key={tab}
          onClick={() => setActive(tab)}
          type="button"
        >
          {tab}
        </button>
      ))}
      <button
        className="create-button"
        aria-label="上传视频"
        onClick={() => fileInputRef.current?.click()}
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
          onClick={() => setActive(tab)}
          type="button"
        >
          {tab}
        </button>
      ))}
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

function KnowledgeNavigationCard({
  currentTime,
  point,
  state,
  progress,
  remainingSeconds,
  total,
  onOpen,
}: {
  currentTime: number
  point?: VideoKnowledgePoint
  state: 'upcoming' | 'explaining' | 'answer'
  progress: number
  remainingSeconds: number
  total: number
  onOpen: () => void
}) {
  const statusText = !point
    ? '等待知识点'
    : state === 'answer'
      ? point.answer
      : state === 'upcoming'
        ? `将在 ${formatTime(point.startTime)} 开始`
        : `正在讲解中 · 还有 ${Math.ceil(remainingSeconds)} 秒`

  return (
    <button
      className="knowledge-navigation-card"
      aria-label="展开视频知识导航"
      onClick={onOpen}
      type="button"
    >
      <p className="knowledge-count">{point?.question ?? `AI已梳理${total}个知识点`}</p>
      <span className="knowledge-index">{point ? point.order : 0}/{total}</span>
      <p className="knowledge-question">{statusText}</p>
      <div
        className="knowledge-progress"
        aria-label={`知识点播放进度，视频当前时间 ${formatTime(currentTime)}`}
      >
        <span className="knowledge-progress-value" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="knowledge-time knowledge-start">{formatTime(point?.startTime ?? 0)}</span>
      <span className="knowledge-time knowledge-end">{formatTime(point?.endTime ?? 0)}</span>
      <span className="knowledge-open">
        查看知识点
        <img src="/assets/player-chevron.svg" alt="" />
      </span>
    </button>
  )
}

function SupplementCardContent({ supplement }: { supplement: UnderstandingSupplement }) {
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
  knowledgePoints,
  supplements,
  onClose,
}: {
  knowledgePoints: VideoKnowledgePoint[]
  supplements: UnderstandingSupplement[]
  onClose: () => void
}) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'knowledge' | 'supplement'>('knowledge')

  return (
    <>
      <button
        className="knowledge-sheet-dismiss"
        aria-label="收起知识点"
        onClick={onClose}
        type="button"
      />
      <section className="knowledge-sheet" aria-label="知识点列表" role="dialog" aria-modal="true">
        <img
          className="knowledge-sheet-background"
          src="/assets/knowledge-sheet-background.svg"
          alt=""
        />
        <div className="knowledge-sheet-tabs" aria-label="知识内容分类" role="tablist">
          <button
            aria-selected={activeTab === 'knowledge'}
            className={activeTab === 'knowledge' ? 'active' : ''}
            onClick={() => setActiveTab('knowledge')}
            role="tab"
            type="button"
          >
            知识点
          </button>
          <button
            aria-selected={activeTab === 'supplement'}
            className={activeTab === 'supplement' ? 'active' : ''}
            onClick={() => setActiveTab('supplement')}
            role="tab"
            type="button"
          >
            补充
          </button>
        </div>
        <div
          className={`knowledge-sheet-tab-indicator ${activeTab === 'supplement' ? 'supplement' : ''}`}
        />
        {activeTab === 'knowledge' ? <ol className="knowledge-sheet-list">
          {knowledgePoints.map((item) => {
            const isExpanded = expandedItem === item.id

            return (
            <li className={isExpanded ? 'expanded' : ''} key={item.id}>
              <button
                aria-expanded={isExpanded}
                onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                type="button"
              >
                <span className="knowledge-sheet-number">{item.order}</span>
                <span className="knowledge-sheet-title">{item.question}</span>
                <span className="knowledge-sheet-timestamp">{formatTime(item.startTime)}</span>
                <img
                  className={isExpanded ? 'expanded' : ''}
                  src={isExpanded
                    ? '/assets/knowledge-sheet-chevron-expanded.svg'
                    : '/assets/knowledge-sheet-chevron-collapsed.svg'}
                  alt=""
                />
              </button>
              {isExpanded && (
                <p className="knowledge-sheet-answer">{item.answer}</p>
              )}
            </li>
            )
          })}
        </ol> : (
          <div className="supplement-list" aria-label="补充内容列表">
            {supplements.map((item) => (
              <article className="supplement-card" key={item.id}>
                <SupplementCardContent supplement={item} />
              </article>
            ))}
          </div>
        )}
      </section>
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
      className="chain-two-hint"
      aria-label="查看链路1识别结果"
      onClick={onOpen}
      type="button"
    >
      <div className="chain-two-hint-copy">
        <strong>{supplement.question}</strong>
        <span>{supplement.helperText}</span>
      </div>
      <span className="chain-two-hint-thumbnail" aria-hidden="true" />
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
      <span className="chain-one-result-countdown">5秒后消失</span>
      <button className="chain-one-result-close" aria-label="关闭识别结果" onClick={onClose} type="button">
        <img src="/assets/chain-one-card-close.svg" alt="" />
      </button>
    </aside>
  )
}

function PlayerPage({ onBack, project }: PlayerPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasUploadedVideo = project.videoUrl.startsWith('blob:')
  const [currentTime, setCurrentTime] = useState(hasUploadedVideo ? 0 : 36.1)
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
  const isTimelinePaused = showKnowledgeSheet || selectedSupplement !== null

  useEffect(() => {
    if (hasUploadedVideo || isTimelinePaused) return

    const clock = window.setInterval(() => {
      setCurrentTime((time) => (time >= project.duration ? 0 : time + 0.25))
    }, 250)

    return () => window.clearInterval(clock)
  }, [hasUploadedVideo, isTimelinePaused, project.duration])

  useEffect(() => {
    if (isTimelinePaused) videoRef.current?.pause()
  }, [isTimelinePaused])

  useEffect(() => {
    if (!showKnowledgeSheet && !selectedSupplement) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowKnowledgeSheet(false)
        setSelectedSupplement(null)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showKnowledgeSheet, selectedSupplement])

  useEffect(() => {
    if (!selectedSupplement) return

    const hideCard = window.setTimeout(() => setSelectedSupplement(null), 5000)
    return () => window.clearTimeout(hideCard)
  }, [selectedSupplement])

  return (
    <main
      className="player-page"
      data-current-time={currentTime.toFixed(2)}
      data-chain1-items={project.supplements.length}
      data-chain2-items={project.knowledgePoints.length}
    >
      <img className="player-status-bar" src="/assets/player-status.svg" alt="9:41，手机状态栏" />

      <div className="player-topbar">
        <button className="player-back" aria-label="返回首页" onClick={onBack} type="button">
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
          <button aria-label="搜索" type="button"><img src="/assets/player-search.svg" alt="" /></button>
        </div>
      </div>

      {hasUploadedVideo ? (
        <video
          ref={videoRef}
          className="video-stage"
          aria-label={`正在播放：${project.title}`}
          controls
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          playsInline
          preload="metadata"
          src={project.videoUrl}
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
        <KnowledgeNavigationCard
          currentTime={snapshot.currentTime}
          point={snapshot.displayedKnowledgePoint}
          state={snapshot.knowledgeState}
          progress={snapshot.knowledgeProgress}
          remainingSeconds={snapshot.knowledgeRemainingSeconds}
          total={project.knowledgePoints.length}
          onOpen={() => {
            if (activeSupplement) {
              setHandledSupplementIds((ids) => new Set(ids).add(activeSupplement.id))
            }
            setSelectedSupplement(null)
            setShowKnowledgeSheet(true)
          }}
        />

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
          onClose={() => setSelectedSupplement(null)}
        />
      )}
      {showKnowledgeSheet && (
        <KnowledgeSheet
          knowledgePoints={project.knowledgePoints}
          supplements={project.supplements}
          onClose={() => setShowKnowledgeSheet(false)}
        />
      )}
    </main>
  )
}

function UploadProcessing({
  status,
  error,
  onRetry,
  onClose,
}: {
  status: AnalysisJobStatus | null
  error: { message: string; retryable: boolean } | null
  onRetry: () => void
  onClose: () => void
}) {
  const progress = Math.round((status?.progress ?? 0) * 100)
  return (
    <div className="upload-processing-backdrop">
      <section className="upload-processing" aria-label={error ? '视频解析失败' : '视频解析中'} aria-live="polite" role="status">
        {!error && <span className="upload-spinner" aria-hidden="true" />}
        <strong>{error ? '视频解析失败' : status?.message ?? '正在上传视频'}</strong>
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
          <small>{progress}% · 两条链路将共用同一份视频时间轴</small>
        )}
      </section>
    </div>
  )
}

function HomePage({
  onOpenVideo,
  onUploadVideo,
  analysisStatus,
  analysisError,
  onRetryAnalysis,
  onCloseAnalysis,
}: {
  onOpenVideo: () => void
  onUploadVideo: (file: File) => void
  analysisStatus: AnalysisJobStatus | null
  analysisError: { message: string; retryable: boolean } | null
  onRetryAnalysis: () => void
  onCloseAnalysis: () => void
}) {
  return (
    <div className="app-shell">
      <header>
        <img className="status-bar" src="/assets/status-bar.svg" alt="9:41，手机状态栏" />
        <div className="channel-navigation" aria-label="频道导航">
          <img src="/assets/top-tabs.png" alt="热门、推荐、关注；当前为推荐" />
        </div>
      </header>

      <main className="feed" aria-label="推荐视频">
        <div className="feed-column left-column">
          <VideoCard
            image="/assets/dead-poets.png"
            title="《死亡诗社》一部被片名误导的伟大电影"
            creator="听风电影笔记"
            avatar="/assets/avatar-listening.svg"
            showMore
            onOpen={onOpenVideo}
          />
          <VideoCard
            image="/assets/hotpot.png"
            imageClassName="landscape-cover"
            title="《死亡诗社》一部被片名误导的伟大电影"
            creator="听风电影笔记"
            avatar="/assets/avatar-gray.svg"
            onOpen={onOpenVideo}
          />
          <div className="skeleton-card skeleton-left" aria-hidden="true" />
        </div>

        <div className="feed-column right-column">
          <VideoCard
            image="/assets/huaian-blind-box.png"
            title="江苏淮安200元开盲盒"
            creator="二百者也"
            reward
            onOpen={onOpenVideo}
          />
          <VideoCard
            image="/assets/zhang-xueliang.png"
            title="蒋介石软禁张学良54年到底花了多少钱"
            onOpen={onOpenVideo}
          />
          <div className="skeleton-card skeleton-right" aria-hidden="true" />
        </div>
      </main>

      <BottomNavigation onUploadVideo={onUploadVideo} />
      {(analysisStatus || analysisError) && (
        <UploadProcessing
          status={analysisStatus}
          error={analysisError}
          onRetry={onRetryAnalysis}
          onClose={onCloseAnalysis}
        />
      )}
    </div>
  )
}

export default function App() {
  const activeJobStorageKey = 'huazhongdian.activeAnalysisJobId'
  const [isPlayerOpen, setPlayerOpen] = useState(window.location.hash === '#video')
  const [project, setProject] = useState<VideoProject>(iceWaterDemoProject)
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisJobStatus | null>(null)
  const [analysisError, setAnalysisError] = useState<{ message: string; retryable: boolean } | null>(null)
  const analysisAbortRef = useRef<AbortController | null>(null)

  const navigateToPlayer = () => {
    window.history.pushState({ view: 'video' }, '', '#video')
    setPlayerOpen(true)
  }

  const watchJob = async (jobId: string) => {
    analysisAbortRef.current?.abort()
    const controller = new AbortController()
    analysisAbortRef.current = controller
    setAnalysisError(null)
    try {
      const analyzedProject = await waitForJob(jobId, setAnalysisStatus, controller.signal)
      setProject(analyzedProject)
      setAnalysisStatus(null)
      window.localStorage.removeItem(activeJobStorageKey)
      navigateToPlayer()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const typed = error as Error & { retryable?: boolean }
      setAnalysisError({ message: typed.message, retryable: typed.retryable === true })
    }
  }

  useEffect(() => {
    const syncViewFromUrl = () => setPlayerOpen(window.location.hash === '#video')
    window.addEventListener('popstate', syncViewFromUrl)
    return () => window.removeEventListener('popstate', syncViewFromUrl)
  }, [])

  useEffect(() => {
    const activeJobId = window.localStorage.getItem(activeJobStorageKey)
    if (activeJobId) void watchJob(activeJobId)
    return () => analysisAbortRef.current?.abort()
  }, [])

  const openPlayer = () => {
    setProject(iceWaterDemoProject)
    navigateToPlayer()
  }

  const uploadVideo = async (file: File) => {
    if (file.type && !file.type.startsWith('video/')) return
    setAnalysisStatus({
      jobId: 'uploading',
      state: 'queued',
      progress: 0,
      message: '正在上传视频',
      retryable: false,
      originalName: file.name,
    })
    setAnalysisError(null)
    try {
      const { jobId } = await submitVideo(file)
      window.localStorage.setItem(activeJobStorageKey, jobId)
      await watchJob(jobId)
    } catch (error) {
      setAnalysisError({ message: error instanceof Error ? error.message : String(error), retryable: false })
    }
  }

  const retryAnalysis = async () => {
    const jobId = window.localStorage.getItem(activeJobStorageKey)
    if (!jobId) return
    try {
      await retryJob(jobId)
      await watchJob(jobId)
    } catch (error) {
      setAnalysisError({ message: error instanceof Error ? error.message : String(error), retryable: false })
    }
  }

  const closeAnalysis = () => {
    analysisAbortRef.current?.abort()
    setAnalysisStatus(null)
    setAnalysisError(null)
  }

  const closePlayer = () => {
    if (window.location.hash === '#video') {
      window.history.back()
    } else {
      setPlayerOpen(false)
    }
  }

  return isPlayerOpen ? (
    <PlayerPage key={project.id} onBack={closePlayer} project={project} />
  ) : (
    <HomePage
      onOpenVideo={openPlayer}
      onUploadVideo={uploadVideo}
      analysisStatus={analysisStatus}
      analysisError={analysisError}
      onRetryAnalysis={retryAnalysis}
      onCloseAnalysis={closeAnalysis}
    />
  )
}
