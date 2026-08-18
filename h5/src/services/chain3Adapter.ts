import type {
  KnowledgePoolItem,
  LearningPathViewModel,
  LearningSource,
  RawReconstructionResult,
  RecommendedResearchQuestion,
  ReconstructionStatus,
} from '../domain/learning'
import type { VideoProjectDto } from '../domain/video'
import { adaptVideoProjectDto } from './backendVideoAnalysisAdapter'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

interface KnowledgePoolDto {
  schemaVersion: 'knowledge-pool.v1'
  items: Array<{
    jobId: string
    addedAt: string
    state: string
    progress: number
    message: string
    retryable: boolean
    error?: string
    project: VideoProjectDto | null
  }>
}

export async function getKnowledgePool(): Promise<KnowledgePoolItem[]> {
  const dto = await requestJson<KnowledgePoolDto>(`${API_BASE}/api/knowledge-pool`)
  if (dto.schemaVersion !== 'knowledge-pool.v1') throw new Error('不支持的视频池版本')
  return dto.items.map((item) => ({
    ...item,
    project: item.project ? adaptVideoProjectDto(item.project) : null,
  }))
}

export async function addToKnowledgePool(jobId: string): Promise<void> {
  await requestJson(`${API_BASE}/api/knowledge-pool/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  })
}

export async function removeFromKnowledgePool(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/knowledge-pool/items/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('移出划重点视频池失败')
}

export async function startReconstruction(args: {
  videoIds: string[]
  requestedAnalysisMode: 'single_creator_series' | 'multi_creator_topic' | 'auto'
  themeHint?: string
}): Promise<{ analysisId: string; status: string }> {
  return requestJson(`${API_BASE}/api/reconstructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
}

export async function getReconstructionStatus(analysisId: string): Promise<ReconstructionStatus> {
  return requestJson(`${API_BASE}/api/reconstructions/${encodeURIComponent(analysisId)}`)
}

export async function getReconstructionResult(analysisId: string): Promise<RawReconstructionResult> {
  return requestJson(`${API_BASE}/api/reconstructions/${encodeURIComponent(analysisId)}/result`)
}

export async function startReconstructionPath(
  analysisId: string,
  researchQuestion: string,
): Promise<{ analysisId: string; status: string }> {
  return requestJson(`${API_BASE}/api/reconstructions/${encodeURIComponent(analysisId)}/path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ researchQuestion }),
  })
}

export function adaptRecommendedQuestions(result: RawReconstructionResult): RecommendedResearchQuestion[] {
  return (result.recommended_questions ?? []).map((item, index) => ({
    id: item.question_id ?? `question-${index + 1}`,
    question: item.question,
    reason: item.reason,
    goalLabel: item.goal_label,
  }))
}

export function adaptLearningPath(
  result: RawReconstructionResult,
  pool: KnowledgePoolItem[],
): LearningPathViewModel {
  const path = result.learning_path
  if (!path) throw new Error(result.coverage_assessment?.message || '重构结果中没有可用学习路径')
  const projects = new Map(
    pool.flatMap((item) => item.project ? [[item.project.id, item.project] as const] : []),
  )
  const source = (item: { video_id: string; start_ms: number; end_ms: number }): LearningSource => {
    const project = projects.get(item.video_id)
    if (!project) throw new Error(`学习路径引用了不存在的视频：${item.video_id}`)
    const startTime = item.start_ms / 1000
    const endTime = item.end_ms / 1000
    const point = project.knowledgePoints.find((candidate) => (
      candidate.endTime >= startTime && candidate.startTime <= endTime
    ))
    return {
      videoId: project.id,
      videoTitle: project.title,
      creator: project.creator,
      videoUrl: project.videoUrl,
      startTime,
      endTime,
      ...(point?.question ? { question: point.question } : {}),
      ...(point?.answer ? { answer: point.answer } : {}),
      supplements: project.supplements.filter((supplement) => (
        supplement.endTime >= startTime && supplement.startTime <= endTime
      )),
    }
  }
  const stages = (path.stages ?? []).map((stage) => ({
    id: stage.stage_id,
    title: stage.title,
    description: stage.goal || stage.reason || '',
    estimatedMinutes: stage.estimated_minutes ?? 0,
    nodes: (stage.knowledge_nodes ?? []).map((node) => ({
      id: node.canonical_node_id,
      title: node.display_title,
      goal: node.learning_goal || '',
      source: source(node.recommended_source),
      alternatives: (node.alternative_sources ?? []).map(source),
      estimatedMinutes: node.estimated_minutes ?? 1,
    })),
  }))
  return {
    id: path.path_id,
    title: path.title,
    goal: path.goal || '',
    estimatedMinutes: path.estimated_minutes ?? 0,
    coverageNote: path.coverage_note || '',
    videoCount: new Set(stages.flatMap((stage) => stage.nodes.map((node) => node.source.videoId))).size,
    stages,
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(body.detail ?? body.error ?? `请求失败：${response.status}`))
  return body as T
}
