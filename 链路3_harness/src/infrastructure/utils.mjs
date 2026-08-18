import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export function stableStringify(value) {
  const seen = new WeakSet()
  const normalize = (input) => {
    if (input === null || typeof input !== 'object') return input
    if (seen.has(input)) throw new TypeError('Cannot stringify circular value')
    seen.add(input)
    if (Array.isArray(input)) return input.map(normalize)
    return Object.fromEntries(
      Object.keys(input).sort().map((key) => [key, normalize(input[key])])
    )
  }
  return JSON.stringify(normalize(value))
}

export function hashValue(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function newId(prefix = 'id') {
  return `${prefix}_${randomUUID()}`
}

export function nowIso() {
  return new Date().toISOString()
}

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true })
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

export async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath))
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, filePath)
}

export async function safeRemove(filePath) {
  await rm(filePath, { force: true })
}

export function parseJsonFromModel(text) {
  if (typeof text !== 'string') return text
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()) } catch {}
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1))
  }
  throw new SyntaxError('Model response does not contain a valid JSON object')
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
