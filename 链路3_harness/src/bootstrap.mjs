import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { loadConfig } from './infrastructure/config.mjs'
import { FileCache } from './infrastructure/file-cache.mjs'
import { TraceStore } from './infrastructure/trace-store.mjs'
import { RunStore } from './infrastructure/run-store.mjs'
import { SchemaValidator } from './infrastructure/schema-validator.mjs'
import { FixtureModelProvider } from './providers/fixture-model-provider.mjs'
import { OpenAICompatibleProvider } from './providers/openai-compatible-provider.mjs'
import { SkillRegistry } from './skills/skill-registry.mjs'
import { OutputContracts } from './skills/output-contracts.mjs'
import { SkillRunner } from './skills/skill-runner.mjs'
import { DurationService } from './services/duration-service.mjs'
import { RetryPolicy } from './harness/retry-policy.mjs'
import { ReconstructionHarness } from './harness/reconstruction-harness.mjs'

export async function createHarness({ projectRoot = process.cwd(), provider = null, dataDir = null } = {}) {
  await loadSharedModelEnvironment(projectRoot)
  const config = await loadConfig({ projectRoot })
  const rootDir = path.resolve(projectRoot, dataDir || process.env.HARNESS_DATA_DIR || '.runtime')
  const skillsDir = path.join(projectRoot, 'skills')

  if (!provider) {
    const kind = process.env.HARNESS_PROVIDER || 'fixture'
    if (kind === 'openai-compatible') {
      const endpoint = process.env.CHAIN3_LLM_BASE_URL || process.env.LLM_BASE_URL || process.env.DOUBAO_ENDPOINT || ''
      provider = new OpenAICompatibleProvider({
        baseUrl: endpoint.replace(/\/(?:chat\/completions|responses)\/?$/, ''),
        apiKey: process.env.LLM_API_KEY || process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY,
        model: process.env.LLM_MODEL || process.env.ARK_API_ENDPOINT_ID || process.env.DOUBAO_MODEL,
        timeoutMs: Number(process.env.LLM_TIMEOUT_MS || process.env.ARK_TIMEOUT_MS || 90000),
        temperature: config.model.temperature,
        maxOutputTokens: config.model.max_output_tokens
      })
    } else {
      provider = new FixtureModelProvider({
        fixturePath: path.resolve(projectRoot, process.env.HARNESS_FIXTURE_PATH || 'examples/mock-skill-responses.json')
      })
    }
  }

  const traceStore = new TraceStore({ rootDir })
  const runStore = new RunStore({ rootDir })
  const cache = new FileCache({
    rootDir,
    ttlByNamespace: {
      'source-knowledge': config.cache.source_knowledge_ttl_seconds,
      'topic-profile': config.cache.topic_profile_ttl_seconds,
      'learning-path': config.cache.learning_path_ttl_seconds
    }
  })
  const registry = await new SkillRegistry({ skillsDir }).init()
  const validator = new SchemaValidator()
  const contracts = new OutputContracts({ skillsDir, validator })
  const skillRunner = new SkillRunner({ registry, provider, contracts, traceStore, config })
  const durationService = new DurationService(config.duration)
  const retryPolicy = new RetryPolicy({ maxReviewRetries: config.execution.max_review_retries })

  const harness = new ReconstructionHarness({
    config,
    skillRunner,
    registry,
    cache,
    runStore,
    traceStore,
    durationService,
    retryPolicy
  })
  return { harness, provider, config, rootDir }
}

async function loadSharedModelEnvironment(projectRoot) {
  const candidates = [
    process.env.CHAIN3_ENV_FILE,
    path.resolve(projectRoot, '../链路2_harness/.env'),
    path.resolve(projectRoot, '../.env'),
  ].filter(Boolean)
  for (const filePath of candidates) {
    let content
    try {
      content = await readFile(filePath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]]) continue
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2')
      process.env[match[1]] = value
    }
  }
}
