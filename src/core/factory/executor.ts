/**
 * Factory executor — advance a DAG run by spawning ready nodes via startAgent.
 * Chat-ui polls `tickFactory` while a run is active.
 */

import { randomBytes } from "node:crypto"
import { agentHandoff, cancelAgent, listAgents, startAgent } from "../agent/spawn.js"
import { fillPrompt, outputsFromNodes, readyNodeIds, sanitizeMachine } from "./dag.js"
import { resolveMachine } from "./machines.js"
import { loadFactory, saveFactory, updateFactory } from "./store.js"
import {
  MAX_OUTPUT_CHARS,
  type FactoryMachineSpec,
  type FactoryNodeState,
  type FactoryRun,
  type FactoryState,
} from "./types.js"

function nowIso(): string {
  return new Date().toISOString()
}

function newRunId(): string {
  return randomBytes(4).toString("hex")
}

function clip(s: string, n = MAX_OUTPUT_CHARS): string {
  if (s.length <= n) return s
  return `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]`
}

function nodeOutputFromAgent(agentId: string): string {
  const h = agentHandoff(agentId)
  if (h?.prose?.trim()) return clip(h.prose.trim())
  return clip(`(agent ${agentId} finished — no handoff prose)`)
}

function isTerminalJob(status: string): "done" | "failed" | null {
  const s = status.toLowerCase()
  if (s === "exited") return "done"
  if (s === "error" || s === "canceled" || s === "cancelled") return "failed"
  return null
}

function machineToRun(machine: FactoryMachineSpec, label: string): FactoryRun {
  const nodes: FactoryNodeState[] = machine.nodes.map((n) => ({
    id: n.id,
    name: (n.name || n.id).slice(0, 48),
    prompt: n.prompt,
    needs: n.needs ?? [],
    status: "pending",
  }))
  const t = nowIso()
  return {
    schema: 1,
    runId: newRunId(),
    machine: label,
    status: "running",
    maxParallel: machine.max_parallel ?? 4,
    nodes,
    createdAt: t,
    updatedAt: t,
  }
}

export type StartFactoryOpts = {
  sessionId: string
  workspace: string
  /** Machine name, path, or JSON object string. */
  machine: string
}

export async function startFactory(opts: StartFactoryOpts): Promise<FactoryState> {
  const cur = loadFactory(opts.sessionId)
  if (cur.run?.status === "running") {
    throw new Error(`factory already running (${cur.run.runId} · ${cur.run.machine}) — /factory stop first`)
  }
  const spec = resolveMachine(opts.machine)
  const label = spec.name || opts.machine.trim().slice(0, 64) || "machine"
  const run = machineToRun(spec, label)
  const state: FactoryState = { schema: 1, run }
  saveFactory(opts.sessionId, state)
  return tickFactory(opts.sessionId, opts.workspace)
}

export function stopFactory(sessionId: string, workspace: string): FactoryState {
  return updateFactory(sessionId, (cur) => {
    const run = cur.run
    if (!run) return cur
    // Idle / finished dock: clear on stop.
    if (run.status !== "running") {
      return { schema: 1, run: null }
    }
    for (const n of run.nodes) {
      if (n.status === "running" && n.agentId) {
        void cancelAgent(workspace, n.agentId).catch(() => {})
        n.status = "canceled"
        n.finishedAt = nowIso()
      } else if (n.status === "pending" || n.status === "ready") {
        n.status = "skipped"
      }
    }
    run.status = "stopped"
    run.finishedAt = nowIso()
    run.updatedAt = nowIso()
    return { schema: 1, run }
  })
}

/**
 * One scheduler step: settle finished agents, spawn ready nodes up to maxParallel.
 */
export async function tickFactory(sessionId: string, workspace: string): Promise<FactoryState> {
  const cur = loadFactory(sessionId)
  const run = cur.run
  if (!run || run.status !== "running") return cur

  // Refresh running nodes from agent/job status.
  const agents = listAgents(workspace, sessionId)
  const byId = new Map(agents.map((a) => [a.id, a]))

  for (const n of run.nodes) {
    if (n.status !== "running" || !n.agentId) continue
    const a = byId.get(n.agentId)
    const st = a?.status ?? "missing"
    const term = isTerminalJob(st)
    if (term === "done") {
      n.status = "done"
      n.output = nodeOutputFromAgent(n.agentId)
      n.finishedAt = nowIso()
    } else if (term === "failed") {
      n.status = "failed"
      n.error = `agent ${n.agentId} ${st}`
      n.finishedAt = nowIso()
    }
  }

  // Fail-fast if any node failed.
  if (run.nodes.some((n) => n.status === "failed")) {
    for (const n of run.nodes) {
      if (n.status === "pending" || n.status === "ready") n.status = "skipped"
      if (n.status === "running" && n.agentId) {
        void cancelAgent(workspace, n.agentId).catch(() => {})
        n.status = "canceled"
        n.finishedAt = nowIso()
      }
    }
    run.status = "failed"
    run.error = run.nodes.find((n) => n.status === "failed")?.error || "node failed"
    run.finishedAt = nowIso()
    run.updatedAt = nowIso()
    saveFactory(sessionId, { schema: 1, run })
    return { schema: 1, run }
  }

  const running = run.nodes.filter((n) => n.status === "running").length
  const slots = Math.max(0, run.maxParallel - running)
  const outs = outputsFromNodes(run.nodes)
  const ready = readyNodeIds(run.nodes)

  for (const id of ready.slice(0, slots)) {
    const n = run.nodes.find((x) => x.id === id)
    if (!n) continue
    const prompt = fillPrompt(n.prompt, outs)
    try {
      const agent = await startAgent(workspace, prompt, {
        name: n.name,
        parentId: sessionId,
      })
      n.status = "running"
      n.agentId = agent.id
      n.jobId = agent.jobId
      n.startedAt = nowIso()
      n.prompt = prompt // store filled prompt for status
    } catch (err) {
      n.status = "failed"
      n.error = err instanceof Error ? err.message : String(err)
      n.finishedAt = nowIso()
      run.status = "failed"
      run.error = n.error
      run.finishedAt = nowIso()
      break
    }
  }

  // Mark ready for UI even if no slots.
  for (const id of readyNodeIds(run.nodes)) {
    const n = run.nodes.find((x) => x.id === id)
    if (n && n.status === "pending") n.status = "ready"
  }

  if (run.status === "running") {
    const allDone = run.nodes.every((n) => n.status === "done")
    const stuck =
      run.nodes.every((n) => n.status === "done" || n.status === "failed" || n.status === "skipped" || n.status === "canceled") &&
      !run.nodes.some((n) => n.status === "running" || n.status === "pending" || n.status === "ready")
    if (allDone) {
      run.status = "done"
      run.finishedAt = nowIso()
    } else if (stuck && run.nodes.some((n) => n.status === "failed" || n.status === "canceled")) {
      run.status = "failed"
      run.finishedAt = nowIso()
    } else if (
      !run.nodes.some((n) => n.status === "running" || n.status === "pending" || n.status === "ready")
    ) {
      // no work left
      run.status = run.nodes.every((n) => n.status === "done") ? "done" : "failed"
      run.finishedAt = nowIso()
    }
  }

  run.updatedAt = nowIso()
  saveFactory(sessionId, { schema: 1, run })
  return { schema: 1, run }
}

export function parseMachineArg(raw: string): FactoryMachineSpec {
  return sanitizeMachine(JSON.parse(raw) as unknown)
}

export function factoryActive(sessionId: string): boolean {
  return loadFactory(sessionId).run?.status === "running"
}
