import type { VideoProject, VideoProjectDto, VideoShowcaseDto } from '../domain/video'
import { resolveSupplementPresentation } from './supplementPresentation'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export interface AnalysisJobStatus {
  jobId: string
  state:
    | 'queued'
    | 'probing'
    | 'transcribing'
    | 'indexing'
    | 'ocr'
    | 'chain1'
    | 'chain2'
    | 'finalizing'
    | 'ready'
    | 'ready_with_fallbacks'
    | 'failed'
  progress: number
  message: string
  retryable: boolean
  error?: string
  fallbacks?: string[]
  originalName?: string
}

export async function uploadVideo(file: File): Promise<{ jobId: string }> {
  const form = new FormData()
  form.append('file', file)
  return requestJson(`${API_BASE}/api/videos`, { method: 'POST', body: form })
}

export async function uploadDouyinVideo(url: string): Promise<{ jobId: string }> {
  return requestJson(`${API_BASE}/api/videos/from-douyin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
}

export async function getJobStatus(jobId: string): Promise<AnalysisJobStatus> {
  return requestJson(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}`)
}

export async function getJobResult(jobId: string): Promise<VideoProject> {
  const dto = await requestJson<VideoProjectDto>(
    `${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/result`,
  )
  return adaptVideoProjectDto(dto)
}

export async function getShowcase(): Promise<VideoProject[]> {
  const dto = await requestJson<VideoShowcaseDto>(`${API_BASE}/api/showcase`)
  if (dto.schemaVersion !== 'video-showcase.v1') throw new Error('不支持的展示清单版本')
  return dto.items.map(adaptVideoProjectDto)
}

export async function retryJob(jobId: string): Promise<void> {
  await requestJson(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' })
}

export async function waitForJob(
  jobId: string,
  onStatus: (status: AnalysisJobStatus) => void,
  signal?: AbortSignal,
): Promise<VideoProject> {
  while (!signal?.aborted) {
    const status = await getJobStatus(jobId)
    onStatus(status)
    if (status.state === 'ready' || status.state === 'ready_with_fallbacks') {
      return getJobResult(jobId)
    }
    if (status.state === 'failed') {
      const error = new Error(status.error || status.message) as Error & {
        retryable?: boolean
        jobId?: string
      }
      error.retryable = status.retryable
      error.jobId = jobId
      throw error
    }
    await delay(1000, signal)
  }
  throw new DOMException('Analysis cancelled', 'AbortError')
}

export function adaptVideoProjectDto(dto: VideoProjectDto): VideoProject {
  if (dto.schemaVersion !== 'video-project.v1') throw new Error('不支持的视频解析结果版本')
  const mediaUrl = (value: string) => value.startsWith('/') ? `${API_BASE}${value}` : value
  return {
    id: dto.id,
    title: dto.title,
    creator: dto.creator,
    duration: dto.durationMs / 1000,
    ...(dto.category ? { category: dto.category } : {}),
    videoUrl: mediaUrl(dto.videoUrl),
    transcript: dto.transcriptSegments.map((item) => ({
      id: item.id,
      startTime: item.startMs / 1000,
      endTime: item.endMs / 1000,
      text: item.text,
    })),
    knowledgePoints: dto.knowledgePoints.map((item) => ({
      id: item.id,
      title: item.title,
      factualStatement: item.factualStatement,
      question: item.question,
      answer: item.answer,
      startTime: item.startMs / 1000,
      endTime: item.endMs / 1000,
      order: item.order,
      ...(item.taskType ? { taskType: item.taskType } : {}),
      evidenceSegmentIds: item.evidenceSegmentIds,
    })),
    supplements: dto.supplements.filter((item) => item.displayMode === 'auto_prompt').map((item) => {
      const presentation = resolveSupplementPresentation(item)

      return {
      id: item.id,
      type: item.type,
      sourceText: item.sourceText,
      startTime: item.startMs / 1000,
      endTime: item.endMs / 1000,
      triggerTime: item.triggerAtMs / 1000,
      displayMode: item.displayMode,
      question: item.question,
      answer: item.answer,
      helperText: presentation.helperText,
      ...(item.answerLabel ? { answerLabel: item.answerLabel } : {}),
      ...(presentation.cardVariant ? { cardVariant: presentation.cardVariant } : {}),
      ...(presentation.cardVariant === 'viewpoint_clarification' && item.leftColumn
        ? { leftColumn: item.leftColumn }
        : {}),
      ...(presentation.cardVariant === 'viewpoint_clarification' && item.rightColumn
        ? { rightColumn: item.rightColumn }
        : {}),
      ...(presentation.sourceCount !== undefined ? { sourceCount: presentation.sourceCount } : {}),
      ...(presentation.sourceAction ? { sourceAction: presentation.sourceAction } : {}),
      renderMode: presentation.renderMode,
      ...(item.hintStickerImageUrl
        ? { hintStickerImageUrl: mediaUrl(item.hintStickerImageUrl) }
        : {}),
      ...(item.hintStickerWidth ? { hintStickerWidth: item.hintStickerWidth } : {}),
      ...(item.hintStickerHeight ? { hintStickerHeight: item.hintStickerHeight } : {}),
      ...(presentation.cardImageUrl ? { cardImageUrl: mediaUrl(presentation.cardImageUrl) } : {}),
      ...(item.cardWidth ? { cardWidth: item.cardWidth } : {}),
      ...(item.cardHeight ? { cardHeight: item.cardHeight } : {}),
      evidenceSegmentIds: item.evidenceSegmentIds,
      }
    }),
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(body.detail ?? `请求失败：${response.status}`))
  return body as T
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Analysis cancelled', 'AbortError'))
    }, { once: true })
  })
}
