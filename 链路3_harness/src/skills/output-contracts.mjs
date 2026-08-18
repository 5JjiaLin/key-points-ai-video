import path from 'node:path'
import { readJson } from '../infrastructure/utils.mjs'
import { ValidationError } from '../domain/errors.mjs'
import { SKILLS } from '../domain/constants.mjs'

export class OutputContracts {
  constructor({ skillsDir, validator }) {
    this.skillsDir = skillsDir
    this.validator = validator
    this.schemas = new Map()
  }

  async schema(name) {
    if (!this.schemas.has(name)) {
      this.schemas.set(name, await readJson(path.join(this.skillsDir, 'schemas', name)))
    }
    return this.schemas.get(name)
  }

  async validate(skillId, output) {
    const failures = []
    const validateOne = async (schemaName, value, label) => {
      const result = this.validator.validate(await this.schema(schemaName), value)
      if (!result.valid) failures.push({ label, errors: result.errors })
    }

    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      failures.push({ label: 'output', errors: [{ path: '$', keyword: 'type', expected: 'object' }] })
    } else if (skillId === SKILLS.VIDEO_SET_ASSESSMENT) {
      await validateOne('video-set-assessment.schema.json', output, 'video-set-assessment')
    } else if (skillId === SKILLS.SOURCE_KNOWLEDGE_EXTRACTION) {
      if (!Array.isArray(output.source_knowledge_points)) failures.push({ label: 'source_knowledge_points', errors: [{ keyword: 'required_array' }] })
      else for (const [i, item] of output.source_knowledge_points.entries()) await validateOne('source-knowledge-point.schema.json', item, `source_knowledge_points[${i}]`)
    } else if (skillId === SKILLS.KNOWLEDGE_NORMALIZATION) {
      if (!Array.isArray(output.canonical_nodes)) failures.push({ label: 'canonical_nodes', errors: [{ keyword: 'required_array' }] })
      else for (const [i, item] of output.canonical_nodes.entries()) await validateOne('canonical-knowledge-node.schema.json', item, `canonical_nodes[${i}]`)
    } else if (skillId === SKILLS.RELATION_ALIGNMENT) {
      if (!Array.isArray(output.relations)) failures.push({ label: 'relations', errors: [{ keyword: 'required_array' }] })
      else for (const [i, item] of output.relations.entries()) await validateOne('knowledge-relation.schema.json', item, `relations[${i}]`)
      for (const [i, item] of (output.source_alignments || []).entries()) await validateOne('source-alignment.schema.json', item, `source_alignments[${i}]`)
    } else if (skillId === SKILLS.QUESTION_RECOMMENDATION) {
      const questions = output.recommended_questions
      if (!Array.isArray(questions) || questions.length < 3 || questions.length > 4) failures.push({ label: 'recommended_questions', errors: [{ keyword: 'minmax_items', expected: '3..4' }] })
      else questions.forEach((item, index) => {
        for (const key of ['question_id','question','goal_label','expected_template','reason','feasibility_score']) {
          if (!(key in item)) failures.push({ label: `recommended_questions[${index}].${key}`, errors: [{ keyword: 'required' }] })
        }
      })
    } else if (skillId === SKILLS.INTENT_PARSING) {
      await validateOne('research-intent.schema.json', output.research_intent, 'research_intent')
      if (!output.coverage_assessment) failures.push({ label: 'coverage_assessment', errors: [{ keyword: 'required' }] })
    } else if (skillId === SKILLS.PATH_PLANNING) {
      if (!Array.isArray(output.filter_decisions)) failures.push({ label: 'filter_decisions', errors: [{ keyword: 'required_array' }] })
      await validateOne('learning-path.schema.json', output.learning_path, 'learning_path')
    } else if (skillId === SKILLS.PATH_REVIEW) {
      await validateOne('path-review-result.schema.json', output, 'path-review-result')
    }

    if (failures.length) throw new ValidationError(`Skill ${skillId} returned invalid output`, failures)
    return output
  }
}
