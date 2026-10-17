/**
 * Decision API — choose-from-options (System 1) + optional host Loop.
 * Uses the active session model by default (no separate System One model).
 */

export const DECISION_FILE = "decision.json"
export const DECISION_SCHEMA = 1

export const DEFAULT_DECIDE_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_TOKENS = 512
export const MAX_ACTIONS = 32
export const MAX_IMAGES = 4
/** Auto-refine / triage: skip when confidence is below this. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.45

export type DecisionAnswer = {
  action: string
  confidence: number
  probabilities: Record<string, number>
  latency_ms: number
  model: string
}

export type DecideOpts = {
  observation: unknown
  actions: Record<string, string>
  goal?: string
  instructions?: string
  history?: Array<{ action: string; confidence?: number | null }>
  images?: string[]
  /** Wall-clock bound for the model call. */
  timeoutMs?: number
  /**
   * Inject model text for tests. Live path uses the active provider via streamTurn.
   * Return body is raw assistant text (JSON).
   */
  callModel?: (input: { system: string; user: string }) => Promise<string>
  /** Override model label in the answer (tests). */
  modelLabel?: string
}

export type LoopOnError = "stop" | "skip"

export type DecisionLoopState = {
  schema: number
  status: "idle" | "running" | "paused" | "stopped" | "error"
  objective: string
  goal: string
  actions: Record<string, string>
  /** Shell in workspace; stdout is the observation. Exit non-zero → on_error. Empty stdout → end loop. */
  observeCmd: string
  /** Shell in workspace; `{action}` replaced; also sets AXI_DECISION_ACTION. */
  actCmd: string
  workspace: string
  instructions: string
  tickMs: number
  maxSteps: number
  historySize: number
  decideTimeoutMs: number
  onError: LoopOnError
  step: number
  history: Array<{
    step: number
    action: string
    confidence: number | null
    latency_ms: number | null
    observationPreview?: string
  }>
  goalUpdates: Array<{ step: number; goal: string; at: string }>
  errors: Array<{ step: number; where: string; error: string }>
  lastError?: string
  createdAt: string
  updatedAt: string
}

export function emptyLoop(): DecisionLoopState {
  const t = new Date().toISOString()
  return {
    schema: DECISION_SCHEMA,
    status: "idle",
    objective: "",
    goal: "",
    actions: {},
    observeCmd: "",
    actCmd: "",
    workspace: "",
    instructions: "Choose the next action that best advances the goal given the observation.",
    tickMs: 0,
    maxSteps: 100,
    historySize: 20,
    decideTimeoutMs: DEFAULT_DECIDE_TIMEOUT_MS,
    onError: "stop",
    step: 0,
    history: [],
    goalUpdates: [],
    errors: [],
    createdAt: t,
    updatedAt: t,
  }
}

export const AUTO_REFINE_ACTIONS: Record<string, string> = {
  refine_local:
    "Run local /refine — trajectory has evidence useful for this session's future turns",
  refine_global:
    "Run global /refine — durable cross-session lesson or explicitly project-qualified preference",
  skip: "Do not refine — one-off noise, unsupported hypothesis, or transient tool output",
  defer: "Not enough signal yet — wait for a later checkpoint",
}

export const EDIT_TRIAGE_ACTIONS: Record<string, string> = {
  keep: "Keep this harness edit — evidence-backed and useful",
  drop: "Drop this edit — speculative, one-off, or redundant",
  promote_global: "Keep and prefer global scope when the refine allows it",
}
