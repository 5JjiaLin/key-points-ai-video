import test from 'node:test'
import assert from 'node:assert/strict'
import { SchemaValidator } from '../src/infrastructure/schema-validator.mjs'

const validator = new SchemaValidator()

test('schema validator accepts valid required object', () => {
  const result = validator.validate({ type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } }, { name: 'ok' })
  assert.equal(result.valid, true)
})

test('schema validator reports missing and enum errors', () => {
  const result = validator.validate({ type: 'object', required: ['mode'], properties: { mode: { enum: ['a','b'] } } }, { mode: 'c' })
  assert.equal(result.valid, false)
  assert.equal(result.errors[0].keyword, 'enum')
})
