import path from 'node:path'
import { appendFile } from 'node:fs/promises'
import { ensureDir, nowIso, newId } from './utils.mjs'

export class TraceStore {
  constructor({ rootDir }) {
    this.rootDir = rootDir
  }

  async append(runId, event) {
    const directory = path.join(this.rootDir, 'traces')
    await ensureDir(directory)
    const payload = {
      event_id: newId('evt'),
      timestamp: nowIso(),
      run_id: runId,
      ...event
    }
    await appendFile(path.join(directory, `${runId}.jsonl`), `${JSON.stringify(payload)}\n`, 'utf8')
    return payload
  }
}
