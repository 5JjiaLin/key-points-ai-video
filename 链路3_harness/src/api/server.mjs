import http from 'node:http'
import { URL } from 'node:url'
import { createHarness } from '../bootstrap.mjs'
import { newId } from '../infrastructure/utils.mjs'

const port = Number(process.env.HARNESS_PORT || 8787)
const { harness } = await createHarness({ projectRoot: process.cwd() })

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

async function body(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === 'POST' && url.pathname === '/api/analysis') {
      const payload = await body(req)
      const analysisId = newId('analysis')
      void harness.runAnalysis({ ...payload, analysis_id: analysisId }).catch(() => {})
      return json(res, 202, { analysis_id: analysisId, status: 'created' })
    }

    const statusMatch = url.pathname.match(/^\/api\/analysis\/([^/]+)\/status$/)
    if (req.method === 'GET' && statusMatch) {
      const run = await harness.getRun(statusMatch[1])
      return json(res, 200, {
        analysis_id: run.analysis_id,
        status: run.status,
        progress: run.progress,
        current_step: run.current_step,
        error: run.error
      })
    }

    const pathMatch = url.pathname.match(/^\/api\/analysis\/([^/]+)\/path$/)
    if (req.method === 'GET' && pathMatch) {
      const run = await harness.getRun(pathMatch[1])
      if (!run.result) return json(res, 202, { status: run.status, progress: run.progress })
      return json(res, 200, run.result)
    }

    const reconstructMatch = url.pathname.match(/^\/api\/analysis\/([^/]+)\/reconstruct$/)
    if (req.method === 'POST' && reconstructMatch) {
      const payload = await body(req)
      const result = await harness.startReconstruction({
        analysisId: reconstructMatch[1],
        researchQuestion: payload.research_question
      })
      return json(res, 202, { analysis_id: result.analysis_id, status: result.status })
    }

    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true })
    return json(res, 404, { error: 'Not found' })
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : 500
    return json(res, status, { error: error.message, code: error.code || 'ERROR', details: error.details || null })
  }
})

server.listen(port, () => console.log(`Harness API listening on http://localhost:${port}`))
