import { SKILLS, STATES } from '../domain/constants.mjs'
import { HarnessError, ValidationError } from '../domain/errors.mjs'
import { hashValue, newId, nowIso, mapWithConcurrency } from '../infrastructure/utils.mjs'
import { StateMachine } from './state-machine.mjs'
import { checkSourceKnowledge, checkCanonicalNodes, checkRelations, checkPath } from '../graders/deterministic-checks.mjs'

export class ReconstructionHarness {
  constructor({ config, skillRunner, registry, cache, runStore, traceStore, durationService, retryPolicy }) {
    this.config = config
    this.skillRunner = skillRunner
    this.registry = registry
    this.cache = cache
    this.runStore = runStore
    this.traceStore = traceStore
    this.durationService = durationService
    this.retryPolicy = retryPolicy
  }

  async runAnalysis(request) {
    const analysisId = request.analysis_id || newId('analysis')
    this.#validateRequest(request)
    let run = {
      analysis_id: analysisId,
      status: STATES.CREATED,
      created_at: nowIso(),
      updated_at: nowIso(),
      request,
      progress: 0,
      current_step: null,
      result: null,
      error: null
    }
    await this.runStore.save(run)
    const state = new StateMachine({ run, runStore: this.runStore, traceStore: this.traceStore })
    try {
      const stable = await this.#buildStableLayer({ request, state, runId: analysisId })
      if (!request.research_question) {
        await state.transition(STATES.RECOMMENDING_QUESTIONS, { progress: 70, current_step: 'question_recommendation', topic_profile_id: stable.profile_id })
        const recommendations = await this.skillRunner.run({
          runId: analysisId,
          skillId: SKILLS.QUESTION_RECOMMENDATION,
          input: this.#questionRecommendationInput(stable)
        })
        await state.transition(STATES.AWAITING_QUESTION, {
          progress: 75,
          current_step: 'awaiting_question',
          result: { topic_profile: stable, recommended_questions: recommendations.recommended_questions }
        })
        return state.run
      }

      const dynamic = await this.#buildDynamicLayer({
        runId: analysisId,
        state,
        stable,
        researchQuestion: request.research_question
      })
      return dynamic
    } catch (error) {
      await this.traceStore.append(analysisId, { event: 'run_failed', error: error.message, code: error.code || 'ERROR', details: error.details || null })
      await state.transition(STATES.FAILED, {
        current_step: error.step || state.run.current_step,
        error: { message: error.message, code: error.code || 'ERROR', details: error.details || null }
      })
      throw error
    }
  }

  async reconstruct({ analysisId, researchQuestion }) {
    const prepared = await this.#prepareReconstruction({ analysisId, researchQuestion })
    return this.#buildDynamicLayer({
      runId: prepared.runId,
      state: prepared.state,
      stable: prepared.stable,
      researchQuestion
    })
  }

  async startReconstruction({ analysisId, researchQuestion }) {
    const prepared = await this.#prepareReconstruction({ analysisId, researchQuestion })
    const started = { ...prepared.state.run }
    void this.#buildDynamicLayer({
      runId: prepared.runId,
      state: prepared.state,
      stable: prepared.stable,
      researchQuestion
    }).catch(async (error) => {
      await this.traceStore.append(prepared.runId, {
        event: 'run_failed',
        error: error.message,
        code: error.code || 'ERROR',
        details: error.details || null
      })
      await prepared.state.transition(STATES.FAILED, {
        current_step: error.step || prepared.state.run.current_step,
        error: { message: error.message, code: error.code || 'ERROR', details: error.details || null }
      })
    })
    return started
  }

  async #prepareReconstruction({ analysisId, researchQuestion }) {
    const previous = await this.runStore.get(analysisId)
    if (!previous.topic_profile_id && !previous.result?.topic_profile?.profile_id) throw new HarnessError('Analysis has no reusable topic profile', { code: 'NO_TOPIC_PROFILE' })
    const profileId = previous.topic_profile_id || previous.result.topic_profile.profile_id
    const stable = await this.cache.get('topic-profile', profileId)
    if (!stable) throw new HarnessError('Topic profile cache is missing or expired', { code: 'TOPIC_PROFILE_MISSING' })

    const newAnalysisId = newId('analysis')
    const run = {
      analysis_id: newAnalysisId,
      parent_analysis_id: analysisId,
      status: STATES.CREATED,
      created_at: nowIso(),
      updated_at: nowIso(),
      request: { ...previous.request, research_question: researchQuestion },
      progress: 70,
      current_step: null,
      topic_profile_id: profileId,
      result: null,
      error: null
    }
    await this.runStore.save(run)
    const state = new StateMachine({ run, runStore: this.runStore, traceStore: this.traceStore })
    return { runId: newAnalysisId, state, stable }
  }

  async getRun(analysisId) {
    return this.runStore.get(analysisId)
  }

  #validateRequest(request) {
    if (!Array.isArray(request.videos)) throw new ValidationError('videos must be an array')
    const { min, max } = this.config.video_limits
    if (request.videos.length < min || request.videos.length > max) throw new ValidationError(`videos must contain ${min} to ${max} items`)
    const ids = new Set()
    for (const video of request.videos) {
      for (const key of ['video_id','creator_id','title','duration_ms']) {
        if (video[key] == null) throw new ValidationError(`video.${key} is required`, { video_id: video.video_id })
      }
      if (ids.has(video.video_id)) throw new ValidationError(`Duplicate video_id ${video.video_id}`)
      ids.add(video.video_id)
    }
  }

  async #buildStableLayer({ request, state, runId }) {
    await state.transition(STATES.ASSESSING_VIDEO_SET, { progress: 5, current_step: 'video_set_assessment' })
    const assessmentCacheKey = this.cache.key({
      videos: request.videos.map((v) => ({ video_id: v.video_id, creator_id: v.creator_id, title: v.title, content_version: v.content_version || '1' })),
      requested_analysis_mode: request.requested_analysis_mode || 'auto',
      theme_hint: request.theme_hint || null,
      skill_version: await this.registry.version(SKILLS.VIDEO_SET_ASSESSMENT)
    })
    let assessment = await this.cache.get('video-set-assessment', assessmentCacheKey)
    if (!assessment) {
      assessment = await this.skillRunner.run({
        runId,
        skillId: SKILLS.VIDEO_SET_ASSESSMENT,
        input: {
          task: 'assess_video_set',
          videos: request.videos.map((video) => ({
            video_id: video.video_id,
            creator_id: video.creator_id,
            title: video.title,
            description: video.description || '',
            asr_summary: video.asr_summary || '',
            published_at: video.published_at || null,
            series_hint: video.series_hint || null,
            user_selected: true
          })),
          user_theme_hint: request.theme_hint || null,
          requested_analysis_mode: request.requested_analysis_mode || 'auto'
        }
      })
      await this.cache.set('video-set-assessment', assessmentCacheKey, assessment)
    } else await this.traceStore.append(runId, { event: 'cache_hit', namespace: 'video-set-assessment', key: assessmentCacheKey })

    const includedIds = new Set(assessment.included_videos.map((item) => item.video_id))
    const includedVideos = request.videos.filter((video) => includedIds.has(video.video_id))
    if (includedVideos.length < this.config.video_limits.min) {
      throw new HarnessError('Too few relevant videos after video-set assessment', { code: 'INSUFFICIENT_RELEVANT_VIDEOS', step: 'video_set_assessment', details: assessment })
    }

    await state.transition(STATES.EXTRACTING_SOURCE_KNOWLEDGE, { progress: 15, current_step: 'source_knowledge_extraction', assessment })
    const extractionVersion = await this.registry.version(SKILLS.SOURCE_KNOWLEDGE_EXTRACTION)
    const artifactMode = String(process.env.CHAIN3_SOURCE_ARTIFACT_MODE || this.config.execution.source_artifact_mode || 'prefer').toLowerCase()
    if (!['prefer', 'require', 'off'].includes(artifactMode)) {
      throw new HarnessError('Invalid source artifact mode', { code: 'INVALID_SOURCE_ARTIFACT_MODE', step: 'source_knowledge_extraction', details: { artifact_mode: artifactMode } })
    }
    const artifactReady = includedVideos.every((video) =>
      video.source_knowledge_artifact?.schema_version === 'source-knowledge-artifact.v1' &&
      Array.isArray(video.source_knowledge_points) && video.source_knowledge_points.length > 0
    )
    let sourcePoints
    if (artifactMode !== 'off' && artifactReady) {
      sourcePoints = includedVideos.flatMap((video) => video.source_knowledge_points)
      const artifactCheck = checkSourceKnowledge({ points: sourcePoints, videos: includedVideos })
      if (!artifactCheck.passed) {
        if (artifactMode === 'require') throw new HarnessError('Source knowledge artifact validation failed', { code: 'ARTIFACT_INVALID_SOURCE_KNOWLEDGE', step: 'source_knowledge_extraction', details: artifactCheck })
        sourcePoints = null
      } else {
        await this.traceStore.append(runId, {
          event: 'source_knowledge_artifact_reused',
          status: 'succeeded',
          video_count: includedVideos.length,
          point_count: sourcePoints.length,
          artifact_ids: includedVideos.map((video) => video.source_knowledge_artifact.artifact_id)
        })
      }
    } else if (artifactMode === 'require') {
      throw new HarnessError('Source knowledge artifact is required', { code: 'ARTIFACT_REQUIRED', step: 'source_knowledge_extraction' })
    }
    if (!sourcePoints) {
      await this.traceStore.append(runId, {
        event: 'legacy_input_fallback',
        status: 'fallback',
        reason: artifactMode === 'off' ? 'artifact_mode_off' : 'artifact_missing_or_invalid'
      })
      const outputs = await mapWithConcurrency(includedVideos, this.config.execution.extraction_concurrency, async (video) => {
        const key = this.cache.key({
          video_id: video.video_id,
          content_version: video.content_version || '1',
          extraction_mode: 'reconstruction_base',
          skill_version: extractionVersion
        })
        const cached = await this.cache.get('source-knowledge', key)
        if (cached) {
          await this.traceStore.append(runId, { event: 'cache_hit', namespace: 'source-knowledge', key, video_id: video.video_id })
          return cached
        }
        const result = await this.skillRunner.run({
          runId,
          skillId: SKILLS.SOURCE_KNOWLEDGE_EXTRACTION,
          input: {
            task: 'extract_source_knowledge',
            extraction_mode: 'reconstruction_base',
            video: {
              video_id: video.video_id,
              creator_id: video.creator_id,
              title: video.title,
              duration_ms: video.duration_ms
            },
            asr_segments: video.asr_segments || [],
            ocr_segments: video.ocr_segments || [],
            visual_segments: video.visual_segments || [],
            chapter_hints: video.chapter_hints || [],
            theme_hint: assessment.theme.title
          }
        })
        await this.cache.set('source-knowledge', key, result)
        return result
      })
      sourcePoints = outputs.flatMap((output) => output.source_knowledge_points)
    }
    const sourceCheck = checkSourceKnowledge({ points: sourcePoints, videos: includedVideos })
    if (!sourceCheck.passed) throw new HarnessError('Source knowledge deterministic checks failed', { code: 'SOURCE_CHECK_FAILED', step: 'source_knowledge_extraction', details: sourceCheck })

    const profileCacheMaterial = {
      theme: assessment.theme,
      mode: assessment.recommended_analysis_mode,
      included_video_ids: [...includedIds].sort(),
      source_hash: hashValue(sourcePoints),
      normalization_version: await this.registry.version(SKILLS.KNOWLEDGE_NORMALIZATION),
      relation_version: await this.registry.version(SKILLS.RELATION_ALIGNMENT)
    }
    const profileId = this.cache.key(profileCacheMaterial)
    const cachedProfile = await this.cache.get('topic-profile', profileId)
    if (cachedProfile) {
      await this.traceStore.append(runId, { event: 'cache_hit', namespace: 'topic-profile', key: profileId })
      await state.transition(STATES.BUILDING_RELATIONS, { progress: 65, current_step: 'topic_profile_cache_hit', topic_profile_id: profileId })
      return cachedProfile
    }

    await state.transition(STATES.NORMALIZING_KNOWLEDGE, { progress: 40, current_step: 'knowledge_normalization' })
    const normalized = await this.skillRunner.run({
      runId,
      skillId: SKILLS.KNOWLEDGE_NORMALIZATION,
      input: {
        task: 'normalize_cross_video_knowledge',
        theme: assessment.theme,
        analysis_mode: assessment.recommended_analysis_mode,
        source_knowledge_points: sourcePoints,
        existing_canonical_nodes: []
      }
    })
    const canonicalCheck = checkCanonicalNodes({ nodes: normalized.canonical_nodes, sourcePoints })
    if (!canonicalCheck.passed) throw new HarnessError('Canonical knowledge checks failed', { code: 'CANONICAL_CHECK_FAILED', step: 'knowledge_normalization', details: canonicalCheck })

    await state.transition(STATES.BUILDING_RELATIONS, { progress: 55, current_step: 'relation_building' })
    const related = await this.skillRunner.run({
      runId,
      skillId: SKILLS.RELATION_ALIGNMENT,
      input: {
        task: 'build_knowledge_relations',
        theme: assessment.theme,
        analysis_mode: assessment.recommended_analysis_mode,
        canonical_nodes: normalized.canonical_nodes,
        source_knowledge_points: sourcePoints,
        video_metadata: includedVideos.map((video) => ({
          video_id: video.video_id,
          creator_id: video.creator_id,
          title: video.title,
          published_at: video.published_at || null,
          series_hint: video.series_hint || null
        })),
        ambiguous_groups: normalized.ambiguous_groups || []
      }
    })
    const relationCheck = checkRelations({ relations: related.relations, nodes: normalized.canonical_nodes })
    if (!relationCheck.passed) throw new HarnessError('Knowledge relation checks failed', { code: 'RELATION_CHECK_FAILED', step: 'relation_building', details: relationCheck })

    const profile = {
      profile_id: profileId,
      created_at: nowIso(),
      theme: assessment.theme,
      analysis_mode: assessment.recommended_analysis_mode,
      assessment,
      videos: includedVideos,
      source_knowledge_points: sourcePoints,
      canonical_nodes: normalized.canonical_nodes,
      ambiguous_groups: normalized.ambiguous_groups || [],
      relations: related.relations,
      source_alignments: related.source_alignments || [],
      knowledge_gaps: related.knowledge_gaps || [],
      versions: {
        extraction: extractionVersion,
        normalization: await this.registry.version(SKILLS.KNOWLEDGE_NORMALIZATION),
        relation: await this.registry.version(SKILLS.RELATION_ALIGNMENT)
      }
    }
    await this.cache.set('topic-profile', profileId, profile)
    await state.transition(STATES.BUILDING_RELATIONS, { progress: 68, current_step: 'topic_profile_ready', topic_profile_id: profileId })
    return profile
  }

  #questionRecommendationInput(stable) {
    return {
      task: 'recommend_research_questions',
      theme: stable.theme,
      analysis_mode: stable.analysis_mode,
      canonical_nodes_summary: stable.canonical_nodes.map((node) => ({
        canonical_node_id: node.canonical_node_id,
        canonical_title: node.canonical_title,
        knowledge_dimension: node.knowledge_dimension,
        topic: node.topic,
        subtopic: node.subtopic,
        intrinsic_difficulty: node.intrinsic_difficulty
      })),
      relation_summary: this.#relationSummary(stable.relations, stable.source_alignments),
      coverage_summary: this.#coverageSummary(stable)
    }
  }

  #relationSummary(relations, alignments) {
    const counts = {}
    for (const item of [...relations, ...alignments.map((a) => ({ relation: a.alignment_type }))]) counts[item.relation] = (counts[item.relation] || 0) + 1
    return counts
  }

  #coverageSummary(stable) {
    return {
      node_count: stable.canonical_nodes.length,
      topic_count: new Set(stable.canonical_nodes.map((node) => node.subtopic || node.topic)).size,
      has_chronology: stable.relations.some((item) => item.relation.startsWith('chronological')),
      has_prerequisite_graph: stable.relations.some((item) => item.relation === 'prerequisite'),
      has_viewpoint_alignment: stable.source_alignments.length > 0,
      has_knowledge_gaps: stable.knowledge_gaps.length > 0
    }
  }

  async #buildDynamicLayer({ runId, state, stable, researchQuestion }) {
    let intentOutput = null
    let planOutput = null
    let candidatePath = null
    let review = null
    let feedback = null
    let retryStep = null

    for (let attempt = 0; ; attempt++) {
      if (!intentOutput || retryStep === 'intent_parsing') {
        await state.transition(STATES.PARSING_INTENT, { progress: 72, current_step: 'intent_parsing', topic_profile_id: stable.profile_id, review_attempt: attempt })
        intentOutput = await this.skillRunner.run({
          runId,
          skillId: SKILLS.INTENT_PARSING,
          feedback: retryStep === 'intent_parsing' ? feedback : null,
          input: {
            task: 'parse_research_question',
            raw_query: researchQuestion,
            theme: stable.theme,
            analysis_mode: stable.analysis_mode,
            available_topics: [...new Set(stable.canonical_nodes.map((node) => node.topic))],
            available_dimensions: [...new Set(stable.canonical_nodes.map((node) => node.knowledge_dimension))],
            coverage_summary: this.#coverageSummary(stable)
          }
        })
      }

      if (intentOutput.coverage_assessment?.status === 'unsupported') {
        await state.transition(STATES.COMPLETED, {
          progress: 100,
          current_step: 'coverage_unsupported',
          topic_profile_id: stable.profile_id,
          result: {
            outcome: 'unsupported_research_question',
            topic_profile: stable,
            research_intent: intentOutput.research_intent,
            coverage_assessment: intentOutput.coverage_assessment
          }
        })
        return state.run
      }

      if (!planOutput || ['knowledge_filtering','path_planning','source_selection','intent_parsing'].includes(retryStep)) {
        await state.transition(STATES.PLANNING_PATH, { progress: 80, current_step: 'path_planning', review_attempt: attempt })
        planOutput = await this.skillRunner.run({
          runId,
          skillId: SKILLS.PATH_PLANNING,
          feedback: ['knowledge_filtering','path_planning','source_selection'].includes(retryStep) ? feedback : null,
          input: {
            task: 'plan_learning_path',
            theme: stable.theme,
            analysis_mode: stable.analysis_mode,
            research_intent: intentOutput.research_intent,
            coverage_assessment: intentOutput.coverage_assessment,
            canonical_nodes: stable.canonical_nodes,
            relations: stable.relations,
            source_alignments: stable.source_alignments,
            knowledge_gaps: stable.knowledge_gaps,
            source_knowledge_points: stable.source_knowledge_points,
            video_metadata: stable.videos.map((video) => ({ video_id: video.video_id, creator_id: video.creator_id, title: video.title })),
            user_context: { completed_node_ids: [], level: null }
          }
        })
      }

      await state.transition(STATES.CALCULATING_DURATION, { progress: 88, current_step: 'duration_calculation' })
      candidatePath = this.durationService.apply(planOutput.learning_path)
      const deterministicChecks = checkPath({
        path: candidatePath,
        nodes: stable.canonical_nodes,
        sourcePoints: stable.source_knowledge_points,
        relations: stable.relations
      })
      deterministicChecks.duration_valid = Number.isInteger(candidatePath.estimated_minutes) && candidatePath.estimated_minutes > 0

      await state.transition(STATES.REVIEWING_PATH, { progress: 94, current_step: 'path_review', review_attempt: attempt })
      review = await this.skillRunner.run({
        runId,
        skillId: SKILLS.PATH_REVIEW,
        input: {
          task: 'review_learning_path',
          theme: stable.theme,
          analysis_mode: stable.analysis_mode,
          research_intent: intentOutput.research_intent,
          coverage_assessment: intentOutput.coverage_assessment,
          canonical_nodes: stable.canonical_nodes,
          relations: stable.relations,
          source_alignments: stable.source_alignments,
          knowledge_gaps: stable.knowledge_gaps,
          source_knowledge_points: stable.source_knowledge_points,
          candidate_path: candidatePath,
          deterministic_checks: deterministicChecks
        }
      })

      const hardCheckPassed = deterministicChecks.passed && deterministicChecks.duration_valid
      if (review.passed && hardCheckPassed) {
        const pathCacheKey = this.cache.key({
          profile_id: stable.profile_id,
          research_intent: intentOutput.research_intent,
          planner_version: await this.registry.version(SKILLS.PATH_PLANNING),
          reviewer_version: await this.registry.version(SKILLS.PATH_REVIEW)
        })
        const finalResult = {
          outcome: 'learning_path_ready',
          topic_profile_id: stable.profile_id,
          research_intent: intentOutput.research_intent,
          coverage_assessment: intentOutput.coverage_assessment,
          filter_decisions: planOutput.filter_decisions,
          learning_path: candidatePath,
          review
        }
        await this.cache.set('learning-path', pathCacheKey, finalResult)
        await state.transition(STATES.COMPLETED, {
          progress: 100,
          current_step: 'completed',
          topic_profile_id: stable.profile_id,
          result: finalResult
        })
        return state.run
      }

      if (!this.retryPolicy.canRetry(attempt)) {
        await state.transition(STATES.NEEDS_REVIEW, {
          progress: 100,
          current_step: 'manual_review',
          topic_profile_id: stable.profile_id,
          result: {
            outcome: 'candidate_path_needs_review',
            research_intent: intentOutput.research_intent,
            coverage_assessment: intentOutput.coverage_assessment,
            filter_decisions: planOutput.filter_decisions,
            candidate_path: candidatePath,
            review,
            deterministic_checks: deterministicChecks
          }
        })
        return state.run
      }

      retryStep = hardCheckPassed ? this.retryPolicy.choose(review) : this.#retryFromDeterministic(deterministicChecks)
      feedback = this.retryPolicy.feedback(review, retryStep)
      await this.traceStore.append(runId, { event: 'local_retry_scheduled', retry_step: retryStep, attempt: attempt + 1, feedback })

      if (['video_set_assessment','source_knowledge_extraction','knowledge_normalization','relation_building'].includes(retryStep)) {
        throw new HarnessError('Stable layer retry requested by path review. Re-run the parent analysis with updated stable inputs.', {
          code: 'STABLE_LAYER_RETRY_REQUIRED',
          step: retryStep,
          details: { review, deterministicChecks }
        })
      }
      if (retryStep === 'duration_calculation') {
        planOutput = { ...planOutput, learning_path: candidatePath }
      }
      if (retryStep === 'manual_review') {
        attempt = this.retryPolicy.maxReviewRetries
      }
    }
  }

  #retryFromDeterministic(checks) {
    if (checks.issues.some((item) => item.type === 'prerequisite_order_violation')) return 'path_planning'
    if (checks.issues.some((item) => item.type.includes('source'))) return 'source_selection'
    if (!checks.duration_valid) return 'duration_calculation'
    return 'path_planning'
  }
}
