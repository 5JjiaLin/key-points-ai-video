import { useRef, useState } from 'react'
import type { KnowledgePoolItem } from '../../domain/learning'
import './knowledgePool.css'

interface KnowledgePoolPageProps {
  items: KnowledgePoolItem[]
  loading: boolean
  error?: string | null
  onBack: () => void
  onOpenVideo: (jobId: string) => void
  onRefresh: () => void
  onRemove: (jobId: string) => void
  onRetry: (jobId: string) => void
  onStartLearning: () => void
  onUploadDouyin: (sourceText: string) => void
  onUploadVideo: (file: File) => void
}

function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function KnowledgePoolPage({
  items,
  loading,
  error,
  onBack,
  onOpenVideo,
  onRefresh,
  onRemove,
  onRetry,
  onStartLearning,
  onUploadDouyin,
  onUploadVideo,
}: KnowledgePoolPageProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [douyinText, setDouyinText] = useState('')
  const [sourceOpen, setSourceOpen] = useState(false)
  const readyCount = items.filter((item) => item.project !== null).length

  return (
    <div className="knowledge-pool-page">
      <img className="knowledge-pool-status" src="/assets/multi-video/status-bar.svg" alt="9:41，手机状态栏" />
      <header className="knowledge-pool-header">
        <button aria-label="返回" onClick={onBack} type="button">
          <img src="/assets/multi-video/flow-back.svg" alt="" />
        </button>
        <div><h1>划重点视频池</h1><p>已解析的视频可以组合成学习路径</p></div>
        <button className="knowledge-pool-refresh" onClick={onRefresh} type="button">刷新</button>
      </header>

      <section className="knowledge-pool-summary">
        <div><strong>{readyCount}</strong><span>条可重构视频</span></div>
        <button onClick={() => setSourceOpen(true)} type="button">+ 添加视频</button>
      </section>

      <main className="knowledge-pool-list" aria-live="polite">
        {loading && items.length === 0 && <p className="knowledge-pool-empty">正在读取视频池…</p>}
        {error && <p className="knowledge-pool-error">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <div className="knowledge-pool-empty">
            <strong>还没有加入视频</strong>
            <span>从视频知识点页添加，或在这里导入新视频</span>
          </div>
        )}
        {items.map((item) => (
          <article className={`knowledge-pool-item ${item.project ? 'ready' : item.state}`} key={item.jobId}>
            <button
              className="knowledge-pool-cover"
              disabled={!item.project}
              onClick={() => onOpenVideo(item.jobId)}
              type="button"
            >
              {item.project ? <span>▶</span> : <span>{Math.round(item.progress * 100)}%</span>}
            </button>
            <div className="knowledge-pool-copy">
              <strong>{item.project?.title ?? item.message}</strong>
              {item.project ? (
                <>
                  <span>{item.project.creator} · {duration(item.project.duration)}</span>
                  <small>{item.project.knowledgePoints.length} 个知识点 · 可用于多视频重构</small>
                </>
              ) : (
                <>
                  <span>{item.error ?? item.message}</span>
                  <progress max={1} value={item.progress} />
                </>
              )}
            </div>
            <div className="knowledge-pool-actions">
              {item.state === 'failed' && item.retryable && (
                <button onClick={() => onRetry(item.jobId)} type="button">重试</button>
              )}
              <button onClick={() => onRemove(item.jobId)} type="button">移出</button>
            </div>
          </article>
        ))}
      </main>

      <footer className="knowledge-pool-footer">
        <p>{readyCount < 3 ? `再添加 ${3 - readyCount} 条视频即可开始重构` : '可选择3–10条视频进行知识重构'}</p>
        <button disabled={readyCount < 3} onClick={onStartLearning} type="button">开始多视频重构</button>
      </footer>

      <input
        ref={fileRef}
        accept="video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onUploadVideo(file)
          event.target.value = ''
        }}
        type="file"
      />
      {sourceOpen && (
        <div className="knowledge-pool-source-backdrop" onClick={() => setSourceOpen(false)} role="presentation">
          <section onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h2>添加到划重点视频池</h2>
            <button onClick={() => { setSourceOpen(false); fileRef.current?.click() }} type="button">从手机选择视频</button>
            <textarea
              onChange={(event) => setDouyinText(event.target.value)}
              placeholder="粘贴抖音链接或分享文案"
              rows={3}
              value={douyinText}
            />
            <button
              disabled={!douyinText.trim()}
              onClick={() => {
                onUploadDouyin(douyinText.trim())
                setDouyinText('')
                setSourceOpen(false)
              }}
              type="button"
            >导入并解析</button>
            <button onClick={() => setSourceOpen(false)} type="button">取消</button>
          </section>
        </div>
      )}
    </div>
  )
}
