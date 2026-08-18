export class DurationService {
  constructor(config) {
    this.config = config
  }

  apply(path) {
    const reading = this.config.reading_seconds_per_node ?? 45
    const stageReview = this.config.review_seconds_per_stage ?? 60
    const alternativeExtra = this.config.comparison_extra_seconds_per_alternative_source ?? 30
    const minimum = this.config.minimum_node_minutes ?? 1
    let totalSeconds = 0

    const stages = (path.stages || []).map((stage) => {
      let stageSeconds = stageReview
      const knowledgeNodes = (stage.knowledge_nodes || []).map((node) => {
        const source = node.recommended_source
        const clipSeconds = Math.max(0, ((source?.end_ms || 0) - (source?.start_ms || 0)) / 1000)
        const alternatives = node.alternative_sources?.length || 0
        const seconds = clipSeconds + reading + alternatives * alternativeExtra
        const estimated = Math.max(minimum, Math.ceil(seconds / 60))
        stageSeconds += estimated * 60
        return { ...node, estimated_minutes: estimated }
      })
      const estimatedStage = Math.max(1, Math.ceil(stageSeconds / 60))
      totalSeconds += estimatedStage * 60
      return { ...stage, knowledge_nodes: knowledgeNodes, estimated_minutes: estimatedStage }
    })

    return {
      ...path,
      stages,
      estimated_minutes: Math.max(1, Math.ceil(totalSeconds / 60))
    }
  }
}
