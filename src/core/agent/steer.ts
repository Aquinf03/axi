/**
 * Steer-interrupt — pause / redirect / inject a running turn, plus message queue.
 * In-memory per chat session (not persisted).
 */

export const STEER_INJECT_PREFIX = "[steer:inject]"
export const STEER_REDIRECT_PREFIX = "[steer:redirect]"

export type SteerQueued = {
  text: string
  kind: "queue" | "inject" | "redirect"
  createdAt: number
}

export type SteerPort = {
  /** Messages typed while busy — drained after the turn. */
  enqueue(text: string): void
  /** Inject between tool batches (mid-flight). */
  inject(text: string): void
  /** Replace direction for the rest of the turn. */
  redirect(text: string): void
  pause(): void
  resume(): void
  abort(reason?: string): void
  /** Fresh abort controller for a new turn (keeps queue). */
  beginTurn(): void
  isPaused(): boolean
  isAborted(): boolean
  abortReason(): string | undefined
  /** AbortSignal for streamTurn (linked to abort()). */
  readonly signal: AbortSignal
  /** Drain mid-flight injects + redirect (called from agent-loop). */
  takeInjections(): { injects: string[]; redirect?: string }
  /** Next queued message after turn settles, or undefined. */
  takeNext(): string | undefined
  /** Drain FIFO queue after turn settles. */
  takeQueue(): string[]
  statusText(): string
  queueLength(): number
  clear(): void
}

export type SteerSession = SteerPort

const MAX_QUEUE = 32
const sessions = new Map<string, SteerSession>()

export function createSteerSession(): SteerSession {
  let controller = new AbortController()
  let paused = false
  let abortReason: string | undefined
  const queue: SteerQueued[] = []
  const injects: string[] = []
  let redirect: string | undefined

  return {
    get signal() {
      return controller.signal
    },
    enqueue(text: string) {
      const t = text.trim()
      if (!t) return
      if (queue.length >= MAX_QUEUE) queue.shift()
      queue.push({ text: t, kind: "queue", createdAt: Date.now() })
    },
    inject(text: string) {
      const t = text.trim()
      if (!t) return
      if (injects.length >= MAX_QUEUE) injects.shift()
      injects.push(t)
    },
    redirect(text: string) {
      const t = text.trim()
      if (!t) return
      redirect = t
    },
    pause() {
      paused = true
    },
    resume() {
      paused = false
    },
    abort(reason = "canceled by user") {
      abortReason = reason
      paused = false
      if (!controller.signal.aborted) controller.abort(reason)
    },
    beginTurn() {
      paused = false
      abortReason = undefined
      if (controller.signal.aborted) controller = new AbortController()
    },
    isPaused() {
      return paused
    },
    isAborted() {
      return controller.signal.aborted
    },
    abortReason() {
      return abortReason
    },
    takeInjections() {
      const out = { injects: injects.splice(0), redirect }
      redirect = undefined
      return out
    },
    takeNext() {
      return queue.shift()?.text
    },
    takeQueue() {
      return queue.splice(0).map((q) => q.text)
    },
    queueLength() {
      return queue.length + injects.length + (redirect ? 1 : 0)
    },
    statusText() {
      const bits = [
        paused ? "paused" : "live",
        controller.signal.aborted ? `aborted (${abortReason ?? "yes"})` : "",
        queue.length ? `queued ${queue.length}` : "",
        injects.length ? `inject ${injects.length}` : "",
        redirect ? "redirect pending" : "",
      ].filter(Boolean)
      return `steer  ${bits.join(" · ")}`
    },
    clear() {
      queue.length = 0
      injects.length = 0
      redirect = undefined
      paused = false
      abortReason = undefined
      controller = new AbortController()
    },
  }
}

/** Per-chat steer session (lazy). */
export function steerFor(sessionId: string): SteerSession {
  let s = sessions.get(sessionId)
  if (!s) {
    s = createSteerSession()
    sessions.set(sessionId, s)
  }
  return s
}

export function clearSteerSession(sessionId: string): void {
  sessions.get(sessionId)?.clear()
  sessions.delete(sessionId)
}

/** True if content is a steer inject/redirect marker. */
export function isSteerInjected(content: string): boolean {
  const c = content.trimStart()
  return c.startsWith(STEER_INJECT_PREFIX) || c.startsWith(STEER_REDIRECT_PREFIX)
}

export function formatSteerInject(text: string): string {
  return `${STEER_INJECT_PREFIX}\n${text.trim()}`
}

export function formatSteerRedirect(text: string): string {
  return `${STEER_REDIRECT_PREFIX}\nNew direction from the human (follow this now):\n${text.trim()}`
}

/** Sleep until resumed or aborted — used by agent-loop pause. */
export async function waitWhilePaused(
  steer: SteerPort,
  sliceMs = 100,
): Promise<"ok" | "aborted"> {
  while (steer.isPaused()) {
    if (steer.isAborted()) return "aborted"
    await new Promise((r) => setTimeout(r, sliceMs))
  }
  return steer.isAborted() ? "aborted" : "ok"
}

/** Combine timeout with optional caller abort. */
export function streamSignal(timeoutMs: number, user?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!user) return timeout
  const anyFn = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal
    }
  ).any
  if (typeof anyFn === "function") return anyFn([timeout, user])
  const c = new AbortController()
  const onAbort = () => {
    try {
      c.abort(user.reason ?? timeout.reason)
    } catch {
      c.abort()
    }
  }
  if (user.aborted || timeout.aborted) {
    onAbort()
    return c.signal
  }
  user.addEventListener("abort", onAbort, { once: true })
  timeout.addEventListener("abort", onAbort, { once: true })
  return c.signal
}

export class SteerAbortError extends Error {
  constructor(message = "turn aborted") {
    super(message)
    this.name = "SteerAbortError"
  }
}

export function isSteerAbortError(err: unknown): boolean {
  if (err instanceof SteerAbortError) return true
  if (err instanceof Error && err.name === "AbortError") return true
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
    return true
  }
  return (
    typeof err === "object" &&
    err != null &&
    "name" in err &&
    (err as { name: string }).name === "AbortError"
  )
}

const STEER_USAGE =
  "usage: /steer status|pause|resume|abort|clear|queue <text>|inject <text>|redirect <text>"

/** Slash handler — works while a turn is running (session-scoped). */
export function runSteerSlash(sessionId: string | undefined, arg: string): { text: string } {
  if (!sessionId) return { text: "steer needs an open chat session" }
  const steer = steerFor(sessionId)
  const tokens = arg.trim().split(/\s+/).filter(Boolean)
  const head = (tokens[0] ?? "status").toLowerCase()
  const rest = arg.trim().slice(tokens[0]?.length ?? 0).trim()

  if (head === "status" || !tokens[0]) return { text: steer.statusText() }
  if (head === "pause") {
    steer.pause()
    return { text: steer.statusText() }
  }
  if (head === "resume" || head === "continue") {
    steer.resume()
    return { text: steer.statusText() }
  }
  if (head === "abort" || head === "cancel" || head === "stop") {
    steer.abort(rest || "canceled by user")
    return { text: steer.statusText() }
  }
  if (head === "clear") {
    steer.clear()
    return { text: "steer  cleared" }
  }
  if (head === "queue" || head === "q") {
    if (!rest) return { text: "usage: /steer queue <text>" }
    steer.enqueue(rest)
    return { text: `steer  queued (${steer.queueLength()})` }
  }
  if (head === "inject" || head === "say") {
    if (!rest) return { text: "usage: /steer inject <text>" }
    steer.inject(rest)
    return { text: `steer  inject pending (${steer.queueLength()})` }
  }
  if (head === "redirect" || head === "redir") {
    if (!rest) return { text: "usage: /steer redirect <text>" }
    steer.redirect(rest)
    return { text: `steer  redirect pending` }
  }
  return { text: STEER_USAGE }
}
