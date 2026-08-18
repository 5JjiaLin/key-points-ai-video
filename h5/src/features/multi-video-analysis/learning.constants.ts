export const LEARNING_TOPIC_MAX_LENGTH = 100
export const LEARNING_PATH_THEME_MAX_LENGTH = 40
export const LEARNING_PATH_STAGE_TITLE_MAX_LENGTH = 14
export const LEARNING_PATH_STAGE_DESCRIPTION_MAX_LENGTH = 20

export function limitLearningTopic(topic: string) {
  return Array.from(topic.trim()).slice(0, LEARNING_TOPIC_MAX_LENGTH).join('')
}

export function limitLearningPathText(text: string, maxLength: number) {
  return Array.from(text.trim()).slice(0, maxLength).join('')
}
