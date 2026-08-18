import type {
  Chain1HarnessOutput,
  Chain2KnowledgePointOutput,
  UnderstandingSupplement,
  VideoKnowledgePoint,
  VideoProject,
} from '../domain/video'

const millisecondsToSeconds = (value: number) => value / 1000

export function adaptChain1Harness(
  output: Chain1HarnessOutput,
): UnderstandingSupplement[] {
  if (output.status === 'failed') return []

  return output.supplements
    .map((item) => ({
      id: item.id,
      type: item.type,
      sourceText: item.sourceText,
      startTime: millisecondsToSeconds(item.startMs),
      endTime: millisecondsToSeconds(item.endMs),
      triggerTime: millisecondsToSeconds(item.triggerAtMs),
      displayMode: item.displayMode,
      question: item.question,
      answer: item.answer,
      helperText: item.subtitle ?? item.answerLabel ?? '查看补充',
      ...(item.answerLabel ? { answerLabel: item.answerLabel } : {}),
      renderMode: item.renderMode,
      ...(item.cardImageUrl ? { cardImageUrl: item.cardImageUrl } : {}),
      ...(item.cardWidth ? { cardWidth: item.cardWidth } : {}),
      ...(item.cardHeight ? { cardHeight: item.cardHeight } : {}),
    }))
    .sort((left, right) => left.triggerTime - right.triggerTime)
}

export function adaptChain2Harness(
  points: Chain2KnowledgePointOutput[],
): VideoKnowledgePoint[] {
  return points
    .map((point, index) => ({
        id: point.knowledge_point_id,
        title: point.statement,
        factualStatement: point.statement,
        question: point.question,
        answer: point.answer,
        startTime: point.start_time,
        endTime: point.end_time,
        order: index + 1,
        ...(point.task_type ? { taskType: point.task_type } : {}),
      }))
    .filter((point) => point.endTime > point.startTime)
    .sort((left, right) => left.startTime - right.startTime)
}

export function buildVideoProject(args: {
  id: string
  title: string
  creator: string
  duration: number
  videoUrl: string
  chain1: Chain1HarnessOutput
  chain2Points: Chain2KnowledgePointOutput[]
}): VideoProject {
  return {
    id: args.id,
    title: args.title,
    creator: args.creator,
    duration: args.duration,
    videoUrl: args.videoUrl,
    knowledgePoints: adaptChain2Harness(args.chain2Points),
    supplements: adaptChain1Harness(args.chain1),
  }
}
