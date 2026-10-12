/**
 * Loop guards: stall redirect → stop before max_agent_steps;
 * optional check that named output paths from the request exist.
 */

import { existsSync, statSync } from "node:fs"
import path from "node:path"

/** Consecutive all-fail tool batches before one redirect. */
export const STALL_ROUNDS_BEFORE_REDIRECT = 3
/** All-fail batches after redirect before hard stop. */
export const STALL_ROUNDS_AFTER_REDIRECT = 2

export type StallState = {
  failStreak: number
  redirected: boolean
}

export function emptyStall(): StallState {
  return { failStreak: 0, redirected: false }
}

export type BatchOutcome = { failed: boolean; denied: boolean }

/**
 * Update stall after a tool batch.
 * Returns whether to inject a redirect, and/or force-stop the tool loop.
 */
export function noteToolBatch(
  state: StallState,
  outcomes: BatchOutcome[],
): { state: StallState; redirect: boolean; stop: boolean } {
  const anyOk = outcomes.some((o) => !o.failed && !o.denied)
  if (outcomes.length === 0 || anyOk) {
    return { state: { ...state, failStreak: 0 }, redirect: false, stop: false }
  }
  const failStreak = state.failStreak + 1
  if (!state.redirected && failStreak >= STALL_ROUNDS_BEFORE_REDIRECT) {
    return {
      state: { failStreak: 0, redirected: true },
      redirect: true,
      stop: false,
    }
  }
  if (state.redirected && failStreak >= STALL_ROUNDS_AFTER_REDIRECT) {
    return {
      state: { failStreak, redirected: true },
      redirect: false,
      stop: true,
    }
  }
  return {
    state: { failStreak, redirected: state.redirected },
    redirect: false,
    stop: false,
  }
}

export const STALL_REDIRECT_MSG =
  "Stall: several tool steps failed without progress. Diagnose once — change method or args (do not repeat the same failing call). Then either make clear progress or stop and tell the user what blocked you."

export const STALL_STOP_MSG =
  "Stop calling tools. You stalled after a redirect. Summarize what failed, what you already did, and the exact next command for the human. Do not invent successful outputs."

/**
 * Pull likely output file paths from the user request (quoted paths, or
 * path-like tokens with a file extension).
 */
export function extractNamedOutputs(objective: string): string[] {
  const found = new Set<string>()
  const re =
    /`([^`\n]+?\.[A-Za-z0-9]{1,12})`|(?:^|[\s("'[=])((?:\.?\.?\/)?[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,12})(?=$|[\s)"'\],])/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(objective))) {
    const raw = (m[1] || m[2] || "").trim()
    if (!raw || raw.length > 180) continue
    if (raw.includes("://")) continue
    if (raw.startsWith("http")) continue
    found.add(raw.replace(/^\.\//, ""))
  }
  return [...found].slice(0, 8)
}

/** Paths that are missing or empty under the workspace. */
export function missingOutputs(workspace: string, named: string[]): string[] {
  const missing: string[] = []
  for (const rel of named) {
    const abs = path.resolve(workspace, rel)
    // Stay inside workspace
    if (!abs.startsWith(path.resolve(workspace) + path.sep) && abs !== path.resolve(workspace)) {
      continue
    }
    if (!existsSync(abs)) {
      missing.push(rel)
      continue
    }
    try {
      if (statSync(abs).size <= 0) missing.push(rel)
    } catch {
      missing.push(rel)
    }
  }
  return missing
}

export function outputCheckMsg(missing: string[]): string {
  return (
    `Before finishing: these paths from the request are missing or empty: ${missing.join(", ")}. ` +
    `Create them now, or clearly say they were not produced (do not claim they exist).`
  )
}
