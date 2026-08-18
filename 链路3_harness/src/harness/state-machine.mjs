import { STATES } from '../domain/constants.mjs'

const TERMINAL = new Set([STATES.COMPLETED, STATES.NEEDS_REVIEW, STATES.FAILED])

export class StateMachine {
  constructor({ run, runStore, traceStore }) {
    this.run = run
    this.runStore = runStore
    this.traceStore = traceStore
  }

  async transition(next, extra = {}) {
    if (TERMINAL.has(this.run.status) && next !== this.run.status) throw new Error(`Cannot transition terminal state ${this.run.status} to ${next}`)
    const previous = this.run.status
    this.run = {
      ...this.run,
      ...extra,
      status: next,
      updated_at: new Date().toISOString()
    }
    await this.runStore.save(this.run)
    await this.traceStore.append(this.run.analysis_id, { event: 'state_changed', previous_state: previous, state: next })
    return this.run
  }
}
