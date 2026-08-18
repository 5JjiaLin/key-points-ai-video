export const SKILLS = Object.freeze({
  VIDEO_SET_ASSESSMENT: 'video-set-assessment',
  SOURCE_KNOWLEDGE_EXTRACTION: 'source-knowledge-extraction-dual-mode',
  KNOWLEDGE_NORMALIZATION: 'cross-video-knowledge-normalization',
  RELATION_ALIGNMENT: 'knowledge-relation-source-alignment',
  QUESTION_RECOMMENDATION: 'research-question-recommendation',
  INTENT_PARSING: 'research-question-parsing',
  PATH_PLANNING: 'knowledge-filtering-path-planning',
  PATH_REVIEW: 'learning-path-review'
})

export const STATES = Object.freeze({
  CREATED: 'created',
  ASSESSING_VIDEO_SET: 'assessing_video_set',
  EXTRACTING_SOURCE_KNOWLEDGE: 'extracting_source_knowledge',
  NORMALIZING_KNOWLEDGE: 'normalizing_knowledge',
  BUILDING_RELATIONS: 'building_relations',
  RECOMMENDING_QUESTIONS: 'recommending_questions',
  AWAITING_QUESTION: 'awaiting_question',
  PARSING_INTENT: 'parsing_intent',
  PLANNING_PATH: 'planning_path',
  CALCULATING_DURATION: 'calculating_duration',
  REVIEWING_PATH: 'reviewing_path',
  COMPLETED: 'completed',
  NEEDS_REVIEW: 'needs_review',
  FAILED: 'failed'
})

export const RETRY_STEPS = Object.freeze([
  'intent_parsing',
  'video_set_assessment',
  'source_knowledge_extraction',
  'knowledge_normalization',
  'relation_building',
  'knowledge_filtering',
  'path_planning',
  'source_selection',
  'duration_calculation',
  'manual_review'
])
