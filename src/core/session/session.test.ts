import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  MAX_CHILDREN,
  createChat,
  createChildSession,
  createWorkerSession,
  deleteChat,
  isChildSession,
  listChats,
  listChildSessions,
  listWorkerSessions,
  loadSession,
  loadSpec,
  registerChild,
  workspaceOf,
} from "../session.js"

describe("portable sessions + child registry", () => {
  let home: string
  let ws: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "axi-home-"))
    ws = mkdtempSync(path.join(tmpdir(), "axi-ws-"))
    prevHome = process.env.AXI_HOME
    process.env.AXI_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AXI_HOME
    else process.env.AXI_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
    rmSync(ws, { recursive: true, force: true })
  })

  it("stores workspace_root and updates it on resume from another dir", () => {
    const chat = createChat(ws)
    assert.equal(workspaceOf(chat), path.resolve(ws))
    assert.ok(!isChildSession(chat))

    const other = mkdtempSync(path.join(tmpdir(), "axi-ws2-"))
    try {
      const resumed = loadSpec(other, chat.id)
      assert.equal(workspaceOf(resumed), path.resolve(other))
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it("hides child sessions from listChats and keeps a bounded parent registry", () => {
    const parent = createChat(ws)
    const child = createChildSession(ws, parent.id, { name: "helper", prompt: "do a thing" })
    assert.equal(child.owner, parent.id)
    assert.ok(isChildSession(child))

    const listed = listChats(ws)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]!.id, parent.id)

    const kids = listChildSessions(parent.id)
    assert.equal(kids.length, 1)
    assert.equal(kids[0]!.id, child.id)

    assert.throws(() => loadSpec(ws, child.id), /child session/)
    const raw = loadSession(child.id)
    assert.equal(raw.owner, parent.id)
  })

  it("rejects registering past MAX_CHILDREN", () => {
    const parent = createChat(ws)
    for (let i = 0; i < MAX_CHILDREN; i++) {
      createChildSession(ws, parent.id, { name: `c${i}` })
    }
    assert.throws(() => createChildSession(ws, parent.id, { name: "overflow" }), /already has/)
    // Direct registry write also enforces the cap.
    assert.throws(() => registerChild(parent.id, "deadbeef"), /already has/)
  })

  it("deletes children when the parent is deleted", () => {
    const parent = createChat(ws)
    const child = createChildSession(ws, parent.id, { name: "kid" })
    deleteChat(ws, parent.id)
    assert.throws(() => loadSession(child.id), /no chat/)
    assert.equal(listChildSessions(parent.id).length, 0)
  })

  it("workspace workers are hidden and listed separately", () => {
    createChat(ws)
    const worker = createWorkerSession(ws, { name: "cli-worker", prompt: "task" })
    assert.ok(isChildSession(worker))
    assert.equal(listChats(ws).length, 1)
    assert.equal(listWorkerSessions(ws).some((w) => w.id === worker.id), true)
  })
})
