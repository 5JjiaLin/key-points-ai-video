import { readJson } from '../infrastructure/utils.mjs'
import { ModelProvider } from './model-provider.mjs'

function selectFixture(entry, input) {
  const serialized = JSON.stringify(input)
  if (entry?.by_video_id && input?.video?.video_id) {
    const selected = entry.by_video_id[input.video.video_id]
    if (selected) return selected
  }
  if (entry?.by_contains) {
    for (const [needle, response] of Object.entries(entry.by_contains)) {
      if (serialized.includes(needle)) return response
    }
  }
  if (Array.isArray(entry?.sequence)) {
    return entry.sequence
  }
  if (entry?.default) return entry.default
  return entry
}

export class FixtureModelProvider extends ModelProvider {
  constructor({ fixturePath }) {
    super()
    this.fixturePath = fixturePath
    this.fixtures = null
    this.calls = []
    this.sequenceIndexes = new Map()
  }

  async init() {
    if (!this.fixtures) this.fixtures = await readJson(this.fixturePath)
    return this
  }

  async complete({ skillId, input, attempt = 0 }) {
    await this.init()
    this.calls.push({ skillId, input, attempt })
    const entry = this.fixtures[skillId]
    if (!entry) throw new Error(`No fixture configured for skill ${skillId}`)
    let selected = selectFixture(entry, input)
    if (Array.isArray(selected)) {
      const index = this.sequenceIndexes.get(skillId) || 0
      selected = selected[Math.min(index, selected.length - 1)]
      this.sequenceIndexes.set(skillId, index + 1)
    }
    return JSON.stringify(selected)
  }

  getCallCount(skillId) {
    return this.calls.filter((item) => !skillId || item.skillId === skillId).length
  }
}
