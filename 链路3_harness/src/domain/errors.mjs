export class HarnessError extends Error {
  constructor(message, { code = 'HARNESS_ERROR', step = null, details = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'HarnessError'
    this.code = code
    this.step = step
    this.details = details
  }
}

export class ValidationError extends HarnessError {
  constructor(message, details) {
    super(message, { code: 'VALIDATION_ERROR', details })
    this.name = 'ValidationError'
  }
}

export class SkillExecutionError extends HarnessError {
  constructor(skillId, message, details) {
    super(message, { code: 'SKILL_EXECUTION_ERROR', step: skillId, details })
    this.name = 'SkillExecutionError'
    this.skillId = skillId
  }
}

export class NotFoundError extends HarnessError {
  constructor(message, details) {
    super(message, { code: 'NOT_FOUND', details })
    this.name = 'NotFoundError'
  }
}
