/**
 * Typed tool-failure feedback + identical-retry block (turn-local).
 * Same tool+args after a failure is refused until the model changes input.
 */

import { createHash } from "node:crypto"

export type FailureCode =
  | "outside_workspace"
  | "not_a_train"
  | "missing_experiment"
  | "deferred_not_loaded"
  | "bad_args"
  | "not_found"
  | "permission"
  | "plan_blocked"
  | "denied"
  | "identical_retry"
  | "unknown"

export type ClassifiedFailure = {
  code: FailureCode
  /** Short instruction for the model — what to change. */
  hint: string
  recoverable: boolean
}

export function callFingerprint(tool: string, rawArgs: string): string {
  let norm = rawArgs.replace(/\s+/g, " ").trim()
  try {
    norm = JSON.stringify(JSON.parse(rawArgs))
  } catch {
    /* keep whitespace-collapsed form */
  }
  return createHash("sha256").update(`${tool}\n${norm}`).digest("hex").slice(0, 24)
}

export function classifyToolFailure(tool: string, message: string): ClassifiedFailure {
  const m = message.toLowerCase()
  if (m.includes("outside train") || m.includes("outside workspace") || m.includes("outside the train")) {
    return {
      code: "outside_workspace",
      hint: "stay inside the workspace/train; use a relative path under the project",
      recoverable: true,
    }
  }
  if (m.includes("not a train")) {
    return {
      code: "not_a_train",
      hint: "cwd is not an aq train — pass the train folder in args, or aq_init / open a train",
      recoverable: true,
    }
  }
  if (m.includes("need experiment.md") || m.includes("experiment.md")) {
    return {
      code: "missing_experiment",
      hint: "create or open experiment.md in the train before this step",
      recoverable: true,
    }
  }
  if (m.includes("deferred tool") || m.includes("tools_search")) {
    return {
      code: "deferred_not_loaded",
      hint: `call tools_search for "${tool}" (or a keyword) before using this tool`,
      recoverable: true,
    }
  }
  if (m.includes("bad tool args") || m.includes("need ") || m.includes("unexpected token")) {
    return {
      code: "bad_args",
      hint: "fix the JSON args to match the tool schema; do not resubmit the same payload",
      recoverable: true,
    }
  }
  if (m.includes("enoent") || m.includes("no such file") || m.includes("not found")) {
    return {
      code: "not_found",
      hint: "path missing — ls/glob first, then retry with a corrected path",
      recoverable: true,
    }
  }
  if (m.includes("eacces") || m.includes("permission denied") || m.includes("eperm")) {
    return {
      code: "permission",
      hint: "OS permission denied — pick another path or ask the human; identical retry will not help",
      recoverable: false,
    }
  }
  if (m.includes("plan mode") || m.includes("mode:plan")) {
    return {
      code: "plan_blocked",
      hint: "plan mode is read-only — switch /mode ask (or full-access) before write/run",
      recoverable: false,
    }
  }
  if (m.includes("denied by user") || (m.includes("denied") && m.includes("human"))) {
    return {
      code: "denied",
      hint: "human denied this call — do not retry unless they ask",
      recoverable: false,
    }
  }
  if (m.includes("identical_retry") || (m.includes("same ") && m.includes("already failed"))) {
    return {
      code: "identical_retry",
      hint: "vary the tool args or pick a different approach",
      recoverable: false,
    }
  }
  return {
    code: "unknown",
    hint: "change args or approach; repeating the exact same call will be blocked",
    recoverable: true,
  }
}

/** Annotate a failure for the model (keeps original text, adds typed hint). */
export function formatToolFailure(tool: string, message: string): string {
  const c = classifyToolFailure(tool, message)
  const body = message.trim() || "(no message)"
  return `[tool-failure code=${c.code}] ${body}\n→ ${c.hint}`
}

export type RetryGuard = {
  /** If this exact call already failed this turn, return a block message; else null. */
  check(tool: string, rawArgs: string): string | null
  /** Record a failed call so an identical retry is blocked. */
  record(tool: string, rawArgs: string, message: string): void
}

/** Turn-local identical-retry guard. */
export function createRetryGuard(): RetryGuard {
  /** fingerprint → prior failure message (already formatted or raw) */
  const failed = new Map<string, string>()

  return {
    check(tool, rawArgs) {
      const fp = callFingerprint(tool, rawArgs)
      const prior = failed.get(fp)
      if (!prior) return null
      const c = classifyToolFailure(tool, prior)
      return (
        `[tool-failure code=identical_retry] refused: same ${tool} args already failed this turn.\n` +
        `prior: ${prior.split("\n")[0]!.slice(0, 200)}\n` +
        `→ change args or method (${c.hint})`
      )
    },
    record(tool, rawArgs, message) {
      failed.set(callFingerprint(tool, rawArgs), message)
    },
  }
}
