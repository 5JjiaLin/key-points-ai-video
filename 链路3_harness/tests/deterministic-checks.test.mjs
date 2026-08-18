import test from 'node:test'
import assert from 'node:assert/strict'
import { detectDirectedCycle, checkPath } from '../src/graders/deterministic-checks.mjs'

test('detects prerequisite cycle', () => {
  const cycle = detectDirectedCycle([
    { source_node_id: 'a', target_node_id: 'b', relation: 'prerequisite' },
    { source_node_id: 'b', target_node_id: 'a', relation: 'prerequisite' }
  ])
  assert.ok(cycle)
})

test('detects prerequisite order violation in path', () => {
  const source = (id, video) => ({ source_knowledge_id:id, source_video_id:video })
  const result = checkPath({
    path: { stages: [{ stage_id:'s', knowledge_nodes: [
      { canonical_node_id:'b', recommended_source:{ source_knowledge_id:'sb', video_id:'v', start_ms:10, end_ms:20 } },
      { canonical_node_id:'a', recommended_source:{ source_knowledge_id:'sa', video_id:'v', start_ms:1, end_ms:9 } }
    ] }] },
    nodes: [
      { canonical_node_id:'a', source_knowledge_ids:['sa'] },
      { canonical_node_id:'b', source_knowledge_ids:['sb'] }
    ],
    sourcePoints: [source('sa','v'), source('sb','v')],
    relations: [{ source_node_id:'a', target_node_id:'b', relation:'prerequisite' }]
  })
  assert.equal(result.order_respects_prerequisites, false)
})
