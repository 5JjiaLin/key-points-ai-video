import path from 'node:path'
import { stat } from 'node:fs/promises'
import { hashValue, readJson, writeJsonAtomic, safeRemove } from './utils.mjs'

export class FileCache {
  constructor({ rootDir, ttlByNamespace = {} }) {
    this.rootDir = rootDir
    this.ttlByNamespace = ttlByNamespace
  }

  key(value) {
    return hashValue(value)
  }

  filePath(namespace, key) {
    return path.join(this.rootDir, 'cache', namespace, `${key}.json`)
  }

  async get(namespace, key) {
    const file = this.filePath(namespace, key)
    try {
      const metadata = await stat(file)
      const ttl = this.ttlByNamespace[namespace]
      if (ttl && Date.now() - metadata.mtimeMs > ttl * 1000) {
        await safeRemove(file)
        return null
      }
      return await readJson(file)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async set(namespace, key, value) {
    await writeJsonAtomic(this.filePath(namespace, key), value)
    return value
  }
}
