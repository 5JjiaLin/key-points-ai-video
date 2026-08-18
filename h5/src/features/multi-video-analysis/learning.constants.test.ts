import { describe, expect, it } from 'vitest'
import {
  LEARNING_PATH_STAGE_DESCRIPTION_MAX_LENGTH,
  LEARNING_PATH_STAGE_TITLE_MAX_LENGTH,
  LEARNING_PATH_THEME_MAX_LENGTH,
  LEARNING_TOPIC_MAX_LENGTH,
  limitLearningPathText,
  limitLearningTopic,
} from './learning.constants'

describe('learning topic character limit', () => {
  it('uses the shared 100-character limit', () => {
    expect(LEARNING_TOPIC_MAX_LENGTH).toBe(100)
    expect(Array.from(limitLearningTopic('主'.repeat(120)))).toHaveLength(100)
  })

  it('keeps a shorter topic unchanged after trimming', () => {
    expect(limitLearningTopic('  黑洞是如何形成的  ')).toBe('黑洞是如何形成的')
  })

  it('keeps the Figma learning-path component capacities', () => {
    expect(LEARNING_PATH_THEME_MAX_LENGTH).toBe(40)
    expect(LEARNING_PATH_STAGE_TITLE_MAX_LENGTH).toBe(14)
    expect(LEARNING_PATH_STAGE_DESCRIPTION_MAX_LENGTH).toBe(20)
    expect(limitLearningPathText('知'.repeat(18), LEARNING_PATH_STAGE_TITLE_MAX_LENGTH)).toBe('知'.repeat(14))
  })
})
