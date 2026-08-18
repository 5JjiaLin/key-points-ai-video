export type SupplementType =
  | 'abstract_to_intuitive'
  | 'knowledge_gap'
  | 'claim_verification'

export type SupplementRenderMode =
  | 'full_generated_image'
  | 'verification_template'
  | 'text_fallback'

export interface UnderstandingSupplement {
  id: string
  type: SupplementType
  sourceText: string
  startTime: number
  endTime: number
  triggerTime: number
  displayMode: 'auto_prompt' | 'list_only'
  question: string
  answer: string
  helperText: string
  answerLabel?: string
  renderMode: SupplementRenderMode
  cardImageUrl?: string
  cardWidth?: number
  cardHeight?: number
  evidenceSegmentIds?: string[]
}

export interface VideoKnowledgePoint {
  id: string
  title: string
  factualStatement: string
  question: string
  answer: string
  startTime: number
  endTime: number
  order: number
  taskType?: string
  evidenceSegmentIds?: string[]
}

export interface TranscriptSegment {
  id: string
  startTime: number
  endTime: number
  text: string
}

export interface VideoProject {
  id: string
  title: string
  creator: string
  duration: number
  videoUrl: string
  transcript?: TranscriptSegment[]
  knowledgePoints: VideoKnowledgePoint[]
  supplements: UnderstandingSupplement[]
}

export interface VideoProjectDto {
  schemaVersion: 'video-project.v1'
  id: string
  title: string
  creator: string
  durationMs: number
  videoUrl: string
  transcriptSegments: Array<{
    id: string
    startMs: number
    endMs: number
    text: string
  }>
  knowledgePoints: Array<{
    id: string
    title: string
    factualStatement: string
    question: string
    answer: string
    startMs: number
    endMs: number
    order: number
    taskType?: string
    evidenceSegmentIds: string[]
  }>
  supplements: Array<{
    id: string
    type: SupplementType
    sourceText: string
    startMs: number
    endMs: number
    triggerAtMs: number
    displayMode: 'auto_prompt' | 'list_only'
    question: string
    answer: string
    subtitle?: string
    answerLabel?: string
    renderMode: SupplementRenderMode
    cardImageUrl?: string
    cardWidth?: number
    cardHeight?: number
    evidenceSegmentIds: string[]
  }>
  analysisStatus: {
    state: 'ready' | 'ready_with_fallbacks'
    fallbacks: string[]
    errors: Record<string, string>
  }
}

export interface Chain1HarnessOutput {
  videoId: string
  status: 'ready' | 'ready_with_fallbacks' | 'failed'
  supplements: Array<{
    id: string
    type: SupplementType
    sourceText: string
    startMs: number
    endMs: number
    triggerAtMs: number
    displayMode: 'auto_prompt' | 'list_only'
    question: string
    answer: string
    subtitle?: string
    answerLabel?: string
    renderMode: SupplementRenderMode
    cardImageUrl?: string
    cardWidth?: number
    cardHeight?: number
  }>
}

export interface Chain2KnowledgePointOutput {
  knowledge_point_id: string
  statement: string
  question: string
  answer: string
  start_time: number
  end_time: number
  task_type?: string
}
