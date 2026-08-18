import path from 'node:path'
import { readJson, writeJsonAtomic } from './utils.mjs'
import { NotFoundError } from '../domain/errors.mjs'

export class RunStore {
  constructor({ rootDir }) {
    this.rootDir = rootDir
  }

  filePath(analysisId) {
    return path.join(this.rootDir, 'runs', `${analysisId}.json`)
  }

  async save(run) {
    await writeJsonAtomic(this.filePath(run.analysis_id), run)
    return run
  }

  async get(analysisId) {
    try {
      return await readJson(this.filePath(analysisId))
    } catch (error) {
      if (error.code === 'ENOENT') throw new NotFoundError(`Analysis ${analysisId} not found`)
      throw error
    }
  }
}
