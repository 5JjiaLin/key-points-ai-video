#!/usr/bin/env node
import path from 'node:path'
import { readJson } from './infrastructure/utils.mjs'
import { createHarness } from './bootstrap.mjs'

const [command = 'run', inputPath = 'examples/earth-evolution-request.json'] = process.argv.slice(2)
const projectRoot = process.cwd()
const request = await readJson(path.resolve(projectRoot, inputPath))
const { harness, rootDir } = await createHarness({ projectRoot })

try {
  let result
  if (command === 'run' || command === 'recommend') {
    if (command === 'recommend') delete request.research_question
    result = await harness.runAnalysis(request)
  } else if (command === 'reconstruct') {
    const analysisId = process.argv[4]
    const researchQuestion = process.argv.slice(5).join(' ')
    result = await harness.reconstruct({ analysisId, researchQuestion })
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
  console.log(JSON.stringify(result, null, 2))
  console.error(`Runtime data: ${rootDir}`)
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code, step: error.step, details: error.details }, null, 2))
  process.exitCode = 1
}
