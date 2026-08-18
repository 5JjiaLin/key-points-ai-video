function actualType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value === 'object' ? 'object' : typeof value
}

function matchesType(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected]
  const type = actualType(value)
  return types.some((candidate) => {
    if (candidate === 'number') return type === 'number' || type === 'integer'
    return type === candidate
  })
}

export class SchemaValidator {
  validate(schema, value) {
    const errors = []
    this.#walk(schema, value, '$', errors)
    return { valid: errors.length === 0, errors }
  }

  assert(schema, value, label = 'value') {
    const result = this.validate(schema, value)
    if (!result.valid) {
      const error = new Error(`${label} failed schema validation`)
      error.validationErrors = result.errors
      throw error
    }
    return value
  }

  #walk(schema, value, path, errors) {
    if (!schema || typeof schema !== 'object') return

    if (schema.type && !matchesType(value, schema.type)) {
      errors.push({ path, keyword: 'type', expected: schema.type, actual: actualType(value) })
      return
    }

    if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
      errors.push({ path, keyword: 'enum', expected: schema.enum, actual: value })
    }

    if (typeof value === 'string') {
      if (schema.minLength != null && value.length < schema.minLength) {
        errors.push({ path, keyword: 'minLength', expected: schema.minLength, actual: value.length })
      }
      if (schema.maxLength != null && value.length > schema.maxLength) {
        errors.push({ path, keyword: 'maxLength', expected: schema.maxLength, actual: value.length })
      }
      if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
        errors.push({ path, keyword: 'pattern', expected: schema.pattern, actual: value })
      }
    }

    if (typeof value === 'number') {
      if (schema.minimum != null && value < schema.minimum) {
        errors.push({ path, keyword: 'minimum', expected: schema.minimum, actual: value })
      }
      if (schema.maximum != null && value > schema.maximum) {
        errors.push({ path, keyword: 'maximum', expected: schema.maximum, actual: value })
      }
    }

    if (Array.isArray(value)) {
      if (schema.minItems != null && value.length < schema.minItems) {
        errors.push({ path, keyword: 'minItems', expected: schema.minItems, actual: value.length })
      }
      if (schema.maxItems != null && value.length > schema.maxItems) {
        errors.push({ path, keyword: 'maxItems', expected: schema.maxItems, actual: value.length })
      }
      if (schema.uniqueItems) {
        const serialized = value.map((item) => JSON.stringify(item))
        if (new Set(serialized).size !== serialized.length) {
          errors.push({ path, keyword: 'uniqueItems', expected: true })
        }
      }
      if (schema.items) {
        value.forEach((item, index) => this.#walk(schema.items, item, `${path}[${index}]`, errors))
      }
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (schema.required) {
        for (const key of schema.required) {
          if (!(key in value)) errors.push({ path: `${path}.${key}`, keyword: 'required' })
        }
      }
      if (schema.properties) {
        for (const [key, childSchema] of Object.entries(schema.properties)) {
          if (key in value) this.#walk(childSchema, value[key], `${path}.${key}`, errors)
        }
      }
      if (schema.additionalProperties === false && schema.properties) {
        for (const key of Object.keys(value)) {
          if (!(key in schema.properties)) errors.push({ path: `${path}.${key}`, keyword: 'additionalProperties' })
        }
      }
    }
  }
}
