function pushIssue(issues, type, message, details = {}) {
  issues.push({ type, message, ...details })
}

export function checkSourceKnowledge({ points, videos }) {
  const issues = []
  const videoMap = new Map(videos.map((video) => [video.video_id, video]))
  const ids = new Set()
  for (const point of points) {
    if (ids.has(point.source_knowledge_id)) pushIssue(issues, 'duplicate_source_knowledge_id', `Duplicate ${point.source_knowledge_id}`)
    ids.add(point.source_knowledge_id)
    const video = videoMap.get(point.source_video_id)
    if (!video) pushIssue(issues, 'unknown_video', `Unknown video ${point.source_video_id}`, { affected_ids: [point.source_knowledge_id] })
    if (point.end_ms <= point.start_ms) pushIssue(issues, 'invalid_time_span', 'end_ms must be greater than start_ms', { affected_ids: [point.source_knowledge_id] })
    if (video?.duration_ms != null && point.end_ms > video.duration_ms) pushIssue(issues, 'time_out_of_bounds', 'Knowledge point exceeds video duration', { affected_ids: [point.source_knowledge_id] })
    if (!String(point.statement || '').trim()) pushIssue(issues, 'empty_statement', 'statement is empty', { affected_ids: [point.source_knowledge_id] })
    if (!String(point.evidence_text || '').trim()) pushIssue(issues, 'missing_evidence', 'evidence_text is empty', { affected_ids: [point.source_knowledge_id] })
  }
  return { passed: issues.length === 0, issues }
}

export function checkCanonicalNodes({ nodes, sourcePoints }) {
  const issues = []
  const sourceIds = new Set(sourcePoints.map((item) => item.source_knowledge_id))
  const nodeIds = new Set()
  for (const node of nodes) {
    if (nodeIds.has(node.canonical_node_id)) pushIssue(issues, 'duplicate_canonical_node_id', `Duplicate ${node.canonical_node_id}`)
    nodeIds.add(node.canonical_node_id)
    if (!node.source_knowledge_ids?.length) pushIssue(issues, 'untraceable_node', 'Canonical node has no source knowledge', { affected_ids: [node.canonical_node_id] })
    for (const sourceId of node.source_knowledge_ids || []) {
      if (!sourceIds.has(sourceId)) pushIssue(issues, 'unknown_source_knowledge', `Unknown source ${sourceId}`, { affected_ids: [node.canonical_node_id] })
    }
  }
  return { passed: issues.length === 0, issues }
}

export function detectDirectedCycle(relations, relationType = 'prerequisite') {
  const edges = relations.filter((item) => item.relation === relationType)
  const graph = new Map()
  for (const edge of edges) {
    if (!graph.has(edge.source_node_id)) graph.set(edge.source_node_id, [])
    graph.get(edge.source_node_id).push(edge.target_node_id)
  }
  const visiting = new Set()
  const visited = new Set()
  const stack = []
  const visit = (node) => {
    if (visiting.has(node)) {
      const index = stack.indexOf(node)
      return [...stack.slice(index), node]
    }
    if (visited.has(node)) return null
    visiting.add(node)
    stack.push(node)
    for (const next of graph.get(node) || []) {
      const cycle = visit(next)
      if (cycle) return cycle
    }
    stack.pop()
    visiting.delete(node)
    visited.add(node)
    return null
  }
  for (const node of graph.keys()) {
    const cycle = visit(node)
    if (cycle) return cycle
  }
  return null
}

export function checkRelations({ relations, nodes }) {
  const issues = []
  const ids = new Set(nodes.map((node) => node.canonical_node_id))
  const edgeKeys = new Set()
  for (const relation of relations) {
    if (!ids.has(relation.source_node_id) || !ids.has(relation.target_node_id)) pushIssue(issues, 'unknown_relation_node', 'Relation references unknown node', { affected_ids: [relation.relation_id] })
    if (relation.source_node_id === relation.target_node_id) pushIssue(issues, 'self_loop', 'Relation cannot connect a node to itself', { affected_ids: [relation.relation_id] })
    const key = `${relation.source_node_id}|${relation.target_node_id}|${relation.relation}`
    if (edgeKeys.has(key)) pushIssue(issues, 'duplicate_relation', `Duplicate relation ${key}`, { affected_ids: [relation.relation_id] })
    edgeKeys.add(key)
  }
  const cycle = detectDirectedCycle(relations, 'prerequisite')
  if (cycle) pushIssue(issues, 'prerequisite_cycle', `Prerequisite cycle: ${cycle.join(' -> ')}`, { affected_ids: cycle })
  return { passed: issues.length === 0, issues, prerequisite_cycle: cycle }
}

export function checkPath({ path, nodes, sourcePoints, relations }) {
  const issues = []
  const nodeMap = new Map(nodes.map((node) => [node.canonical_node_id, node]))
  const sourceMap = new Map(sourcePoints.map((point) => [point.source_knowledge_id, point]))
  const pathOrder = new Map()
  let order = 0
  for (const stage of path?.stages || []) {
    if (!stage.knowledge_nodes?.length) pushIssue(issues, 'empty_stage', `Stage ${stage.stage_id} is empty`, { affected_ids: [stage.stage_id] })
    for (const item of stage.knowledge_nodes || []) {
      pathOrder.set(item.canonical_node_id, order++)
      const canonical = nodeMap.get(item.canonical_node_id)
      if (!canonical) pushIssue(issues, 'unknown_path_node', `Unknown node ${item.canonical_node_id}`, { affected_ids: [item.canonical_node_id] })
      const source = sourceMap.get(item.recommended_source?.source_knowledge_id)
      if (!source) pushIssue(issues, 'unknown_recommended_source', 'Recommended source does not exist', { affected_ids: [item.canonical_node_id] })
      else {
        if (source.source_video_id !== item.recommended_source.video_id) pushIssue(issues, 'source_video_mismatch', 'Recommended source video mismatch', { affected_ids: [item.canonical_node_id] })
        if (canonical && !canonical.source_knowledge_ids.includes(source.source_knowledge_id)) pushIssue(issues, 'source_not_bound_to_node', 'Recommended source is not mapped to canonical node', { affected_ids: [item.canonical_node_id] })
        if (item.recommended_source.end_ms <= item.recommended_source.start_ms) pushIssue(issues, 'invalid_recommended_span', 'Recommended source span is invalid', { affected_ids: [item.canonical_node_id] })
      }
    }
  }
  for (const relation of relations.filter((item) => item.relation === 'prerequisite')) {
    if (pathOrder.has(relation.source_node_id) && pathOrder.has(relation.target_node_id) && pathOrder.get(relation.source_node_id) > pathOrder.get(relation.target_node_id)) {
      pushIssue(issues, 'prerequisite_order_violation', `${relation.source_node_id} must appear before ${relation.target_node_id}`, { affected_ids: [relation.source_node_id, relation.target_node_id] })
    }
  }
  return {
    schema_valid: true,
    all_ids_exist: !issues.some((item) => item.type.includes('unknown')),
    all_nodes_traceable: !issues.some((item) => ['unknown_recommended_source','source_not_bound_to_node','source_video_mismatch'].includes(item.type)),
    prerequisite_cycle_found: Boolean(detectDirectedCycle(relations, 'prerequisite')),
    order_respects_prerequisites: !issues.some((item) => item.type === 'prerequisite_order_violation'),
    duration_valid: true,
    passed: issues.length === 0,
    issues
  }
}
