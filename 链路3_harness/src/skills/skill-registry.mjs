import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { readJson } from '../infrastructure/utils.mjs'
import { NotFoundError } from '../domain/errors.mjs'

export class SkillRegistry {
  constructor({ skillsDir }) {
    this.skillsDir = skillsDir
    this.manifest = null
    this.cache = new Map()
  }

  async init() {
    if (!this.manifest) this.manifest = await readJson(path.join(this.skillsDir, 'skill-manifest.json'))
    return this
  }

  async get(skillId) {
    await this.init()
    if (this.cache.has(skillId)) return this.cache.get(skillId)
    const metadata = this.manifest.skills.find((skill) => skill.id === skillId)
    if (!metadata) throw new NotFoundError(`Skill ${skillId} is not registered`)
    const instructions = await readFile(path.join(this.skillsDir, metadata.file), 'utf8')
    const skill = { ...metadata, instructions }
    this.cache.set(skillId, skill)
    return skill
  }

  async version(skillId) {
    return (await this.get(skillId)).version
  }
}
