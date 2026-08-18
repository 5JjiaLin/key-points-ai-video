import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { buildCreatorCollections, buildMultiCreatorVideos } from './learning.fixture'
import type { CreatorCollection, LearningField, LearningVideo } from './learning.types'
import './multiVideoLearning.css'
import './multiVideoAnalysis.css'

const assetRoot = '/assets/multi-video'

type ReconstructionMode = 'multi-creator' | 'single-creator'

interface LearningSelectionPageProps {
  field: LearningField
  videos?: LearningVideo[]
  collections?: CreatorCollection[]
  initialSelectedVideoIds?: string[]
  onBack: () => void
  onNext: (selection: { videoIds: string[]; mode: ReconstructionMode }) => void
}

interface AnalysisModeCardProps {
  accent: 'cyan' | 'violet'
  active: boolean
  creatorCount: number
  expanded: boolean
  iconUrl: string
  mode: ReconstructionMode
  subtitle: string
  title: string
  videoCount: number
  onSelect: () => void
  onToggleExpanded: () => void
  children: ReactNode
}

function SelectionMark({ selected, partial = false }: { selected: boolean; partial?: boolean }) {
  if (selected) return <img src={`${assetRoot}/selected-checkbox.svg`} alt="" />
  return <span className={`learning-selection-empty-check ${partial ? 'partial' : ''}`} aria-hidden="true" />
}

function AnalysisModeCard({
  accent,
  active,
  children,
  creatorCount,
  expanded,
  iconUrl,
  mode,
  onSelect,
  onToggleExpanded,
  subtitle,
  title,
  videoCount,
}: AnalysisModeCardProps) {
  const regionId = `analysis-mode-${mode}`

  return (
    <section className={`analysis-mode-card ${accent} ${active ? 'active' : ''} ${expanded ? 'expanded' : ''}`}>
      <div className="analysis-mode-heading">
        <button aria-label={`选择${title}`} className="analysis-mode-select" onClick={onSelect} type="button">
          <img className="analysis-mode-icon" src={iconUrl} alt="" />
          <span>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
        </button>
        <input
          aria-label={`${title}${active ? '，已选择' : ''}`}
          checked={active}
          name="analysis-mode"
          onChange={onSelect}
          type="radio"
        />
      </div>

      <button
        aria-controls={regionId}
        aria-expanded={expanded}
        className="analysis-recognition-summary"
        onClick={onToggleExpanded}
        type="button"
      >
        <img className="analysis-recognition-icon" src={`${assetRoot}/analysis-recognized-videos-icon.png`} alt="" />
        <span className="analysis-recognition-copy">
          <span>已识别：</span>
          <strong>{creatorCount}</strong>
          <span>位创作者，相关视频</span>
          <strong>{videoCount}</strong>
          <span>条</span>
        </span>
        <img
          className="analysis-recognition-chevron"
          src={`${assetRoot}/collection-expand.svg`}
          alt=""
        />
      </button>

      <div className="analysis-mode-expandable" id={regionId} hidden={!expanded}>
        {children}
      </div>
    </section>
  )
}

function AnalysisVideoRow({
  selected,
  showCreator = true,
  video,
  onToggle,
}: {
  selected: boolean
  showCreator?: boolean
  video: LearningVideo
  onToggle: () => void
}) {
  return (
    <button
      aria-label={`${selected ? '取消选择' : '选择'}视频：${video.title}`}
      aria-pressed={selected}
      className="analysis-video-row"
      onClick={onToggle}
      type="button"
    >
      <span className="analysis-selection-mark"><SelectionMark selected={selected} /></span>
      <span className="analysis-video-cover" aria-hidden="true" />
      <span className="analysis-video-copy">
        <strong>{video.title}</strong>
        <span className="analysis-video-meta">
          {showCreator && <span>{video.creator}</span>}
          <span>{video.duration}</span>
        </span>
      </span>
    </button>
  )
}

function AnalysisCollection({
  collection,
  expanded,
  selectedVideoIds,
  onToggleCollection,
  onToggleExpanded,
  onToggleVideo,
}: {
  collection: CreatorCollection
  expanded: boolean
  selectedVideoIds: Set<string>
  onToggleCollection: () => void
  onToggleExpanded: () => void
  onToggleVideo: (videoId: string) => void
}) {
  const selectedCount = collection.videos.filter((video) => selectedVideoIds.has(video.id)).length
  const allSelected = selectedCount === Math.min(10, collection.videos.length)

  return (
    <section className={`analysis-collection ${expanded ? 'expanded' : ''}`}>
      <div className="analysis-collection-heading">
        <button
          aria-label={`${allSelected ? '取消选择' : '选择'}合集：${collection.title}`}
          aria-pressed={allSelected}
          className="analysis-collection-check"
          onClick={onToggleCollection}
          type="button"
        >
          <SelectionMark selected={allSelected} partial={selectedCount > 0 && !allSelected} />
        </button>
        <span className="analysis-video-cover" aria-hidden="true" />
        <span className="analysis-collection-copy">
          <strong>合集：{collection.title}</strong>
          <span>
            <span>{collection.creator}</span>
            <span>{collection.videos.length}集</span>
          </span>
        </span>
        <button
          aria-expanded={expanded}
          className="analysis-collection-toggle"
          onClick={onToggleExpanded}
          type="button"
        >
          <span>{expanded ? '收起' : '展开'}</span>
          <img src={`${assetRoot}/collection-expand.svg`} alt="" />
        </button>
      </div>

      {expanded && (
        <div className="analysis-collection-videos">
          {collection.videos.map((video) => (
            <AnalysisVideoRow
              key={video.id}
              selected={selectedVideoIds.has(video.id)}
              showCreator={false}
              video={video}
              onToggle={() => onToggleVideo(video.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function toggleSetValue(current: Set<string>, value: string) {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else if (next.size < 10) next.add(value)
  return next
}

export function LearningSelectionPage({
  field,
  videos: providedVideos,
  collections: providedCollections,
  initialSelectedVideoIds,
  onBack,
  onNext,
}: LearningSelectionPageProps) {
  const usesLiveVideos = providedVideos !== undefined
  const videos = useMemo(
    () => providedVideos ?? buildMultiCreatorVideos(field),
    [field, providedVideos],
  )
  const collections = useMemo(
    () => providedCollections ?? buildCreatorCollections(field),
    [field, providedCollections],
  )
  const eligibleCollections = usesLiveVideos
    ? collections.filter((collection) => collection.videos.length >= 3)
    : collections
  const primaryCollection = eligibleCollections[0] ?? {
    id: 'unavailable',
    title: '暂时没有可用系列',
    creator: '需要同一作者至少3条视频',
    videos: [],
  }
  const primaryCollectionVideoIds = useMemo(
    () => primaryCollection.videos.map((video) => video.id),
    [primaryCollection],
  )
  const initialMode: ReconstructionMode = eligibleCollections.length ? 'single-creator' : 'multi-creator'
  const [mode, setMode] = useState<ReconstructionMode>(initialMode)
  const [expandedMode, setExpandedMode] = useState<ReconstructionMode | null>(initialMode)
  const [isCollectionExpanded, setCollectionExpanded] = useState(true)
  const [selectedMultiVideoIds, setSelectedMultiVideoIds] = useState(
    () => new Set(
      initialSelectedVideoIds === undefined
        ? usesLiveVideos ? [] : videos.map((video) => video.id)
        : initialSelectedVideoIds.filter((id) => videos.some((video) => video.id === id)).slice(0, 10),
    ),
  )
  const [selectedCollectionVideoIds, setSelectedCollectionVideoIds] = useState(
    () => new Set(
      initialSelectedVideoIds === undefined
        ? usesLiveVideos ? [] : primaryCollectionVideoIds
        : initialSelectedVideoIds.filter((id) => primaryCollectionVideoIds.includes(id)).slice(0, 10),
    ),
  )

  const selectedCount = mode === 'multi-creator'
    ? selectedMultiVideoIds.size
    : selectedCollectionVideoIds.size
  const multiCreatorCount = new Set(videos.map((video) => video.creator)).size
  const canContinue = usesLiveVideos ? selectedCount >= 3 && selectedCount <= 10 : selectedCount > 0

  const selectMode = (nextMode: ReconstructionMode) => {
    setMode(nextMode)
    setExpandedMode(nextMode)
  }

  const toggleMode = (nextMode: ReconstructionMode) => {
    setMode(nextMode)
    setExpandedMode((current) => current === nextMode ? null : nextMode)
  }

  const toggleCollection = () => {
    setSelectedCollectionVideoIds((current) => {
      const next = new Set(current)
      const allSelected = next.size === Math.min(10, primaryCollection.videos.length)
      primaryCollection.videos.forEach((video) => {
        if (allSelected) next.delete(video.id)
        else if (next.size < 10) next.add(video.id)
      })
      return next
    })
  }

  return (
    <div className="learning-flow-page learning-selection-page learning-analysis-page">
      <img className="learning-flow-status analysis-status-bar" src={`${assetRoot}/status-bar.svg`} alt="9:41，手机状态栏" />

      <header className="analysis-page-header">
        <button className="learning-flow-back analysis-page-back" aria-label="返回领域选择" onClick={onBack} type="button">
          <img src={`${assetRoot}/flow-back.svg`} alt="" />
        </button>
        <h1>选择分析方式</h1>
        <p>选择最符合你学习目标的解构方式</p>
      </header>

      {usesLiveVideos && videos.length === 0 && (
        <p className="analysis-empty-hint" role="status">
          「{field.name}」暂无已解析的视频，先去上传或等待该领域的视频完成解析。
        </p>
      )}

      <main className="analysis-mode-list" aria-label="分析方式">
        <AnalysisModeCard
          accent="cyan"
          active={mode === 'single-creator'}
          creatorCount={1}
          expanded={expandedMode === 'single-creator'}
          iconUrl={`${assetRoot}/analysis-single-creator-icon.png`}
          mode="single-creator"
          subtitle="跟着一位博主系统学"
          title="单博主系列"
          videoCount={primaryCollection.videos.length}
          onSelect={() => eligibleCollections.length && selectMode('single-creator')}
          onToggleExpanded={() => toggleMode('single-creator')}
        >
          <AnalysisCollection
            collection={primaryCollection}
            expanded={isCollectionExpanded}
            selectedVideoIds={selectedCollectionVideoIds}
            onToggleCollection={toggleCollection}
            onToggleExpanded={() => setCollectionExpanded((current) => !current)}
            onToggleVideo={(videoId) => setSelectedCollectionVideoIds((current) => toggleSetValue(current, videoId))}
          />
        </AnalysisModeCard>

        <AnalysisModeCard
          accent="violet"
          active={mode === 'multi-creator'}
          creatorCount={multiCreatorCount}
          expanded={expandedMode === 'multi-creator'}
          iconUrl={`${assetRoot}/analysis-multi-creator-icon.png`}
          mode="multi-creator"
          subtitle="从不同博主拼出完整理解"
          title="多博主同主题"
          videoCount={videos.length}
          onSelect={() => selectMode('multi-creator')}
          onToggleExpanded={() => toggleMode('multi-creator')}
        >
          <div className="analysis-multi-video-list">
            {videos.map((video) => (
              <AnalysisVideoRow
                key={video.id}
                selected={selectedMultiVideoIds.has(video.id)}
                video={video}
                onToggle={() => setSelectedMultiVideoIds((current) => toggleSetValue(current, video.id))}
              />
            ))}
          </div>
        </AnalysisModeCard>
      </main>

      <footer className="analysis-page-footer">
        <button
          disabled={!canContinue}
          onClick={() => onNext({
            videoIds: [...(mode === 'multi-creator' ? selectedMultiVideoIds : selectedCollectionVideoIds)],
            mode,
          })}
          type="button"
        >
          <span>{usesLiveVideos && !canContinue ? `请选择3–10条视频（已选${selectedCount}条）` : '下一步：选择研究问题'}</span>
          <img src={`${assetRoot}/field-chevron.svg`} alt="" />
        </button>
      </footer>
    </div>
  )
}
