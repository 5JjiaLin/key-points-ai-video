import type {
  UnderstandingSupplement,
  VideoKnowledgePoint,
  VideoProject,
} from '../domain/video'

export const KNOWLEDGE_ANSWER_HOLD_SECONDS = 3.5
export const SUPPLEMENT_FULL_PROMPT_SECONDS = 4

export type KnowledgeDisplayState = 'upcoming' | 'explaining' | 'answer'

export interface TimelineSnapshot {
  currentTime: number
  currentKnowledgePoint?: VideoKnowledgePoint
  nextKnowledgePoint?: VideoKnowledgePoint
  displayedKnowledgePoint?: VideoKnowledgePoint
  knowledgeState: KnowledgeDisplayState
  knowledgeProgress: number
  knowledgeRemainingSeconds: number
  activeSupplement?: UnderstandingSupplement
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function createTimelineSnapshot(
  project: VideoProject,
  currentTime: number,
): TimelineSnapshot {
  const points = project.knowledgePoints
  const currentKnowledgePoint = points.find(
    (point) => currentTime >= point.startTime && currentTime < point.endTime,
  )
  const completedPoint = [...points]
    .reverse()
    .find(
      (point) =>
        currentTime >= point.endTime &&
        currentTime < point.endTime + KNOWLEDGE_ANSWER_HOLD_SECONDS,
    )
  const nextKnowledgePoint = points.find((point) => point.startTime > currentTime)

  let displayedKnowledgePoint = currentKnowledgePoint
  let knowledgeState: KnowledgeDisplayState = 'explaining'

  if (!displayedKnowledgePoint && completedPoint) {
    displayedKnowledgePoint = completedPoint
    knowledgeState = 'answer'
  } else if (!displayedKnowledgePoint) {
    displayedKnowledgePoint = nextKnowledgePoint ?? points.at(-1)
    knowledgeState = 'upcoming'
  }

  const knowledgeDuration = displayedKnowledgePoint
    ? displayedKnowledgePoint.endTime - displayedKnowledgePoint.startTime
    : 0
  const knowledgeProgress =
    displayedKnowledgePoint && knowledgeState !== 'upcoming' && knowledgeDuration > 0
      ? clamp((currentTime - displayedKnowledgePoint.startTime) / knowledgeDuration)
      : 0
  const knowledgeRemainingSeconds = displayedKnowledgePoint
    ? Math.max(0, displayedKnowledgePoint.endTime - currentTime)
    : 0
  const activeSupplement = project.supplements.find(
    (item) =>
      item.displayMode === 'auto_prompt' &&
      currentTime >= item.triggerTime &&
      currentTime < item.triggerTime + SUPPLEMENT_FULL_PROMPT_SECONDS,
  )

  return {
    currentTime,
    ...(currentKnowledgePoint ? { currentKnowledgePoint } : {}),
    ...(nextKnowledgePoint ? { nextKnowledgePoint } : {}),
    ...(displayedKnowledgePoint ? { displayedKnowledgePoint } : {}),
    knowledgeState,
    knowledgeProgress,
    knowledgeRemainingSeconds,
    ...(activeSupplement ? { activeSupplement } : {}),
  }
}
