import path from 'node:path'
import { readJson } from './utils.mjs'

export async function loadConfig({ projectRoot = process.cwd(), configPath = null } = {}) {
  const resolved = configPath || path.join(projectRoot, 'config', 'harness.config.json')
  return readJson(resolved)
}
