import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { createHarness } from '../src/bootstrap.mjs'
import { readJson } from '../src/infrastructure/utils.mjs'
import { SKILLS } from '../src/domain/constants.mjs'

test('runs full chain3 harness and reuses stable layer on reconstruct', async () => {
  const projectRoot = path.resolve('.')
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chain3-harness-'))
  try {
    const request = await readJson(path.join(projectRoot, 'examples/earth-evolution-request.json'))
    const { harness, provider } = await createHarness({ projectRoot, dataDir })
    const first = await harness.runAnalysis(request)
    assert.equal(first.status, 'completed')
    assert.equal(first.result.outcome, 'learning_path_ready')
    assert.equal(first.result.learning_path.template, 'timeline_path')
    assert.ok(first.result.learning_path.estimated_minutes > 0)

    const extractionCallsBefore = provider.getCallCount(SKILLS.SOURCE_KNOWLEDGE_EXTRACTION)
    const second = await harness.reconstruct({
      analysisId: first.analysis_id,
      researchQuestion: '比较不同视频中的共同点和补充'
    })
    assert.equal(second.status, 'completed')
    assert.equal(second.result.learning_path.template, 'viewpoint_comparison')
    assert.equal(provider.getCallCount(SKILLS.SOURCE_KNOWLEDGE_EXTRACTION), extractionCallsBefore)
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

test('returns recommendations and pauses when no question is supplied', async () => {
  const projectRoot = path.resolve('.')
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chain3-recommend-'))
  try {
    const request = await readJson(path.join(projectRoot, 'examples/earth-evolution-request-no-question.json'))
    const { harness } = await createHarness({ projectRoot, dataDir })
    const result = await harness.runAnalysis(request)
    assert.equal(result.status, 'awaiting_question')
    assert.ok(result.result.recommended_questions.length >= 3)
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

test('starts dynamic reconstruction asynchronously from a stable profile', async () => {
  const projectRoot = path.resolve('.')
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chain3-async-'))
  try {
    const request = await readJson(path.join(projectRoot, 'examples/earth-evolution-request-no-question.json'))
    const { harness } = await createHarness({ projectRoot, dataDir })
    const stable = await harness.runAnalysis(request)
    const started = await harness.startReconstruction({
      analysisId: stable.analysis_id,
      researchQuestion: '比较不同视频中的共同点和补充'
    })
    assert.equal(started.status, 'created')

    let completed = started
    for (let attempt = 0; attempt < 50 && !['completed', 'failed', 'needs_review'].includes(completed.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      completed = await harness.getRun(started.analysis_id)
    }
    assert.equal(completed.status, 'completed')
    assert.equal(completed.result.outcome, 'learning_path_ready')
    await new Promise((resolve) => setTimeout(resolve, 20))
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})
