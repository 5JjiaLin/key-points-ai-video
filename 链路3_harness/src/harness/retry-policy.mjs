const PRIORITY = [
  'video_set_assessment',
  'source_knowledge_extraction',
  'knowledge_normalization',
  'relation_building',
  'intent_parsing',
  'knowledge_filtering',
  'path_planning',
  'source_selection',
  'duration_calculation',
  'manual_review'
]

export class RetryPolicy {
  constructor({ maxReviewRetries = 2 }) {
    this.maxReviewRetries = maxReviewRetries
  }

  canRetry(attempt) {
    return attempt < this.maxReviewRetries
  }

  choose(review) {
    const steps = (review.issues || [])
      .filter((issue) => issue.severity === 'high' || issue.severity === 'medium')
      .map((issue) => issue.retry_step)
    if (!steps.length) return 'path_planning'
    return PRIORITY.find((step) => steps.includes(step)) || 'manual_review'
  }

  feedback(review, retryStep) {
    return {
      retry_step: retryStep,
      issues: (review.issues || []).filter((item) => item.retry_step === retryStep),
      previous_score: review.score
    }
  }
}
