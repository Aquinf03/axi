import { startChatUi } from "../../ui/chat-ui.js"
import { latestChat, listAllChats, listChats, loadSpec } from "../session.js"
import { shortPath } from "../paths.js"
import { ChatListSnapshot, renderSnapshot } from "../output.js"

export async function chatCmd(argv: string[]): Promise<void> {
  const cwd = process.cwd()
  const json = argv.includes("--json")
  const rest = argv.filter((a) => a !== "--json")
  const sub = rest[0]
  if (!sub || sub === "new") {
    await startChatUi(cwd)
    return
  }
  if (sub === "list" || sub === "ls") {
    const all = rest.includes("--all")
    const chats = all ? listAllChats() : listChats(cwd)
    const rows = chats.map((c) => ({
      id: c.id,
      name: c.name,
      ...(all && c.train ? { train: shortPath(c.train) } : {}),
    }))
    const snap = new ChatListSnapshot(rows, all)
    process.stdout.write(renderSnapshot(snap, json ? "json" : "text"))
    if (!json) process.stdout.write("\n")
    return
  }
  if (sub === "last") {
    const last = latestChat(cwd)
    if (!last) throw new Error("no chats yet")
    await startChatUi(cwd, last.id)
    return
  }
  loadSpec(cwd, sub)
  await startChatUi(cwd, sub)
}
