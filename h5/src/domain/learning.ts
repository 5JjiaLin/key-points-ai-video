import type { UnderstandingSupplement, VideoProject } from './video'

export interface KnowledgePoolItem {
  jobId: string
  addedAt: string
  state: string
  progress: number
  message: string
  retryable: boolean
  error?: string
  project: VideoProject | null
}

export interface ReconstructionStatus {
  analysisId: string
  status: string
  progress: number
  currentStep?: string | null
  error?: { message?: string; code?: string } | null
}

export interface RecommendedResearchQuestion {
  id: string
  question: string
  reason?: string
  goalLabel?: string
}

export interface LearningSource {
  videoId: string
  videoTitle: string
  creator: string
  videoUrl: string
  startTime: number
  endTime: number
  question?: string
  answer?: string
  supplements: UnderstandingSupplement[]
}

export interface LearningNodeViewModel {
  id: string
  title: string
  goal: string
  source: LearningSource
  alternatives: LearningSource[]
  estimatedMinutes: number
}

export interface LearningStageViewModel {
  id: string
  title: string
  description: string
  estimatedMinutes: number
  nodes: LearningNodeViewModel[]
}

export interface LearningPathViewModel {
  id: string
  title: string
  goal: string
  estimatedMinutes: number
  coverageNote: string
  videoCount: number
  stages: LearningStageViewModel[]
}

export interface RawReconstructionResult {
  status?: string
  progress?: number
  outcome?: string
  topic_profile?: {
    videos?: Array<{ video_id: string }>
  }
  recommended_questions?: Array<{
    question_id?: string
    question: string
    reason?: string
    goal_label?: string
  }>
  coverage_assessment?: {
    status?: string
    message?: string
  }
  learning_path?: {
    path_id: string
    title: string
    goal?: string
    estimated_minutes?: number
    coverage_note?: string
    stages?: Array<{
      stage_id: string
      title: string
      goal?: string
      reason?: string
      estimated_minutes?: number
      knowledge_nodes?: Array<{
        canonical_node_id: string
        display_title: string
        learning_goal?: string
        estimated_minutes?: number
        recommended_source: {
          video_id: string
          start_ms: number
          end_ms: number
        }
        alternative_sources?: Array<{
          video_id: string
          start_ms: number
          end_ms: number
        }>
      }>
    }>
  }
}
