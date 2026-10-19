/**
 * Factory executor — advance a DAG run by spawning ready nodes via startAgent.
 * Supports when-guards, foreach expansion, and loop retries.
 * Chat-ui polls `tickFactory` while a run is active.
 */

import { randomBytes } from "node:crypto"
import { agentHandoff, agentLog, cancelAgent, listAgents, startAgent } from "../agent/spawn.js"
import { getArlSessionId } from "../arl.js"
import { recordPruneReceipt, requirePruneWhy } from "../prune.js"
import { depSatisfied, fillPrompt, outputsFromNodes, readyNodeIds, sanitizeMachine } from "./dag.js"
import { evalGuard, extractList, joinGroupOutput } from "./guard.js"
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
    when: n.when,
    foreach: n.foreach,
    loop: n.loop,
    entryCount: 0,
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
  /** Machine name, path, JSON, or MACHINE.md path. */
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
    if (run.status !== "running") {
      return { schema: 1, run: null }
    }
    for (const n of run.nodes) {
      if (n.status === "running" && n.agentId) {
        void cancelAgent(workspace, n.agentId, {
          why: "factory stopped",
          sessionId,
        }).catch(() => {})
        n.status = "canceled"
        n.finishedAt = nowIso()
      } else if (n.status === "pending" || n.status === "ready" || n.status === "waiting") {
        n.status = "skipped"
      }
    }
    run.status = "stopped"
    run.finishedAt = nowIso()
    run.updatedAt = nowIso()
    return { schema: 1, run }
  })
}

/** Cancel one running node (slash/tool — no TUI change). Requires why (prune-with-receipt). */
export function cancelFactoryNode(
  sessionId: string,
  workspace: string,
  nodeId: string,
  why: string,
): FactoryState {
  const reason = requirePruneWhy(why)
  return updateFactory(sessionId, (cur) => {
    const run = cur.run
    if (!run || run.status !== "running") throw new Error("no active factory run")
    const n = run.nodes.find((x) => x.id === nodeId)
    if (!n) throw new Error(`no factory node ${nodeId}`)
    recordPruneReceipt({
      kind: "factory",
      targetId: nodeId,
      name: n.name || n.id,
      why: reason,
      tried: n.prompt?.slice(0, 400) || `factory node ${nodeId}`,
      sessionId: sessionId || getArlSessionId(),
    })
    if (n.status === "running" && n.agentId) {
      void cancelAgent(workspace, n.agentId, {
        why: reason,
        sessionId,
        skipReceipt: true,
      }).catch(() => {})
    }
    n.status = "failed"
    n.error = `canceled: ${reason}`
    n.finishedAt = nowIso()
    run.updatedAt = nowIso()
    return { schema: 1, run }
  })
}

/** Tail log for a node's agent (slash/tool — no TUI change). */
export function factoryNodeLog(sessionId: string, workspace: string, nodeId: string, tail = 40): string {
  const run = loadFactory(sessionId).run
  if (!run) throw new Error("no factory run")
  const n = run.nodes.find((x) => x.id === nodeId)
  if (!n) throw new Error(`no factory node ${nodeId}`)
  if (!n.agentId) return `node ${nodeId}  ${n.status}  (no agent yet)`
  return agentLog(workspace, n.agentId, tail)
}

function failRun(run: FactoryRun, workspace: string, err: string): void {
  const sid = getArlSessionId()
  for (const n of run.nodes) {
    if (n.status === "pending" || n.status === "ready" || n.status === "waiting") n.status = "skipped"
    if (n.status === "running" && n.agentId) {
      void cancelAgent(workspace, n.agentId, {
        why: `factory fail-fast: ${err}`.slice(0, 500),
        sessionId: sid,
      }).catch(() => {})
      n.status = "canceled"
      n.finishedAt = nowIso()
    }
  }
  run.status = "failed"
  run.error = err
  run.finishedAt = nowIso()
  run.updatedAt = nowIso()
}

function expandForeach(run: FactoryRun, parent: FactoryNodeState): void {
  if (!parent.foreach) return
  const over = run.nodes.find((n) => n.id === parent.foreach!.over)
  const src = over?.output ?? ""
  const items = extractList(src, parent.foreach.path).slice(0, parent.foreach.max ?? 8)
  if (!items.length) {
    parent.status = "failed"
    parent.error = `foreach ${parent.id}: empty list from ${parent.foreach.over}`
    parent.finishedAt = nowIso()
    return
  }
  // Remove any prior instances of this group
  run.nodes = run.nodes.filter((n) => n.groupId !== parent.id)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    run.nodes.push({
      id: `${parent.id}__${i}`,
      name: `${parent.name.slice(0, 40)}:${i}`.slice(0, 48),
      prompt: parent.prompt,
      needs: parent.needs.filter((d) => d !== parent.foreach!.over).concat(parent.foreach.over),
      status: "pending",
      groupId: parent.id,
      foreachIndex: i,
      item,
      entryCount: 0,
    })
  }
  parent.status = "waiting"
  parent.startedAt = parent.startedAt ?? nowIso()
}

function settleForeachParents(run: FactoryRun): void {
  for (const n of run.nodes) {
    if (n.status !== "waiting" || !n.foreach) continue
    const kids = run.nodes.filter((k) => k.groupId === n.id)
    if (!kids.length) continue
    if (kids.some((k) => k.status === "failed" || k.status === "canceled")) {
      n.status = "failed"
      n.error = kids.find((k) => k.error)?.error || "foreach child failed"
      n.finishedAt = nowIso()
      continue
    }
    if (kids.every((k) => k.status === "done")) {
      n.status = "done"
      n.output = joinGroupOutput(run.nodes, n.id)
      n.finishedAt = nowIso()
    }
  }
}

function maybeLoop(run: FactoryRun, n: FactoryNodeState): boolean {
  if (!n.loop) return false
  const max = n.loop.max ?? 3
  const entries = n.entryCount ?? 1
  const passed = evalGuard(n.loop.until, run.nodes, {
    selfId: n.id,
    selfOutput: n.output ?? "",
  })
  if (passed) return false
  if (entries >= max) {
    n.status = "failed"
    n.error = `loop exhausted after ${entries} entries`
    return false
  }
  // Reset optional deps
  for (const rid of n.loop.reset ?? []) {
    for (const t of run.nodes) {
      if (t.id === rid || t.groupId === rid) {
        if (t.groupId === rid && t.id !== rid) {
          // drop foreach kids; parent re-expands
          continue
        }
        if (t.id === rid) {
          t.status = "pending"
          t.output = undefined
          t.error = undefined
          t.agentId = undefined
          t.jobId = undefined
          t.finishedAt = undefined
          t.startedAt = undefined
        }
      }
    }
    // remove foreach children for reset group
    run.nodes = run.nodes.filter((x) => x.groupId !== rid)
    const parent = run.nodes.find((x) => x.id === rid)
    if (parent?.foreach) parent.status = "pending"
  }
  n.status = "pending"
  n.agentId = undefined
  n.jobId = undefined
  n.output = undefined
  n.error = undefined
  n.finishedAt = undefined
  n.startedAt = undefined
  n.entryCount = entries
  return true
}

/**
 * One scheduler step: settle finished agents, expand foreach, spawn ready nodes.
 */
export async function tickFactory(sessionId: string, workspace: string): Promise<FactoryState> {
  const cur = loadFactory(sessionId)
  const run = cur.run
  if (!run || run.status !== "running") return cur

  const agents = listAgents(workspace, sessionId)
  const byId = new Map(agents.map((a) => [a.id, a]))

  for (const n of run.nodes) {
    if (n.status !== "running" || !n.agentId) continue
    const a = byId.get(n.agentId)
    const st = a?.status ?? "missing"
    const term = isTerminalJob(st)
    if (term === "done") {
      n.output = nodeOutputFromAgent(n.agentId)
      n.finishedAt = nowIso()
      n.entryCount = (n.entryCount ?? 0) + 1
      const looped = maybeLoop(run, n)
      if (!looped) {
        // maybeLoop may set failed (exhausted) or leave status as running
        if ((n.status as string) !== "failed") n.status = "done"
      }
    } else if (term === "failed") {
      n.status = "failed"
      n.error = `agent ${n.agentId} ${st}`
      n.finishedAt = nowIso()
    }
  }

  settleForeachParents(run)

  if (run.nodes.some((n) => n.status === "failed")) {
    failRun(run, workspace, run.nodes.find((n) => n.status === "failed")?.error || "node failed")
    saveFactory(sessionId, { schema: 1, run })
    return { schema: 1, run }
  }

  const outs = outputsFromNodes(run.nodes)
  const ready = readyNodeIds(run.nodes)

  // Expand foreach templates first (doesn't consume parallel slots the same way)
  for (const id of ready) {
    const n = run.nodes.find((x) => x.id === id)
    if (!n?.foreach || n.groupId) continue
    if (n.when && !evalGuard(n.when, run.nodes)) {
      n.status = "skipped"
      n.finishedAt = nowIso()
      continue
    }
    expandForeach(run, n)
  }

  const running = run.nodes.filter((n) => n.status === "running").length
  let slots = Math.max(0, run.maxParallel - running)
  const ready2 = readyNodeIds(run.nodes)

  for (const id of ready2) {
    if (slots <= 0) break
    const n = run.nodes.find((x) => x.id === id)
    if (!n) continue
    if (n.foreach && !n.groupId) continue // parent already expanded / waiting
    if (n.when && !evalGuard(n.when, run.nodes)) {
      n.status = "skipped"
      n.finishedAt = nowIso()
      continue
    }
    const extra: Record<string, string> = {}
    if (n.item != null) {
      extra.item = n.item
      extra.item_index = String(n.foreachIndex ?? 0)
    }
    const prompt = fillPrompt(n.prompt, outs, extra)
    try {
      const agent = await startAgent(workspace, prompt, {
        name: n.name,
        parentId: sessionId,
      })
      n.status = "running"
      n.agentId = agent.id
      n.jobId = agent.jobId
      n.startedAt = nowIso()
      n.prompt = prompt
      slots--
    } catch (err) {
      n.status = "failed"
      n.error = err instanceof Error ? err.message : String(err)
      n.finishedAt = nowIso()
      failRun(run, workspace, n.error)
      break
    }
  }

  for (const id of readyNodeIds(run.nodes)) {
    const n = run.nodes.find((x) => x.id === id)
    if (n && n.status === "pending") n.status = "ready"
  }

  settleForeachParents(run)

  if (run.status === "running") {
    const active = run.nodes.some(
      (n) =>
        n.status === "running" ||
        n.status === "pending" ||
        n.status === "ready" ||
        n.status === "waiting",
    )
    if (!active) {
      const failed = run.nodes.some((n) => n.status === "failed" || n.status === "canceled")
      run.status = failed ? "failed" : "done"
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

// re-export for tests
export { depSatisfied }
