/**
 * Slash command catalog for the web composer autocomplete.
 * Keep in sync with axi-backend `builtins/commands.ts` → SLASH_SPECS.
 */

export type SlashCommand = { name: string; hint: string }

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", hint: "commands" },
  { name: "/web", hint: "on · off · status · <port>" },
  { name: "/new", hint: "start a new chat" },
  { name: "/rename", hint: "rename this chat" },
  { name: "/chats", hint: "list chats" },
  { name: "/open", hint: "open a chat by name or id" },
  { name: "/url", hint: "open URL · bare hosts get https://" },
  { name: "/copy", hint: "copy last reply (or text) to clipboard" },
  { name: "/delete", hint: "delete this chat · /delete all" },
  { name: "/compact", hint: "summarize older messages" },
  { name: "/undo", hint: "undo last agent turn" },
  { name: "/image", hint: "attach an image by path" },
  { name: "/context", hint: "context window use" },
  { name: "/history", hint: "input history" },
  { name: "/status", hint: "session snapshot · tokens / cache-hit / ~$" },
  { name: "/doctor", hint: "health check" },
  { name: "/spawn", hint: "worker agents · cancel <id> <why>" },
  { name: "/agents", hint: "live agents view · list for text board" },
  { name: "/daemon", hint: "background supervisor · status|start|stop" },
  { name: "/provider", hint: "openai · anthropic · grok · ollama" },
  { name: "/model", hint: "set model id" },
  { name: "/temp", hint: "sampling temperature 0–2 · /temp show|reset" },
  { name: "/key", hint: "paste an api key" },
  { name: "/sound", hint: "on · off" },
  { name: "/notify", hint: "on · off · reply desktop alerts" },
  { name: "/mode", hint: "ask · auto · plan · full-access" },
  { name: "/config", hint: "reload · status|approve|deny · gate on|off" },
  { name: "/steer", hint: "mid-flight · pause|resume|abort|queue|inject|redirect" },
  { name: "/codemode", hint: "sticky Node scratchpad · on|off|status · reset · stop" },
  { name: "/stance", hint: "explore · execute · challenge · status · unpin" },
  { name: "/investigate", hint: "hypothesis graph · status|add|link|abandon|clear" },
  { name: "/revise", hint: "clear a contradicted claim · done <id> · gate on|off" },
  { name: "/pivot", hint: "mark a move · hypothesis|tension|pivot|…" },
  { name: "/evidence", hint: "grade a claim · observed|derived|inferred|unknown" },
  { name: "/reconcile", hint: "claim↔run · match|mismatch|unknown" },
  { name: "/ledger", hint: "port obligations · init|add|owner|close" },
  { name: "/audit", hint: "residual unknowns · resolve|accept|drop" },
  { name: "/turn", hint: "mark last turn · accept|edit|undo|retry|deny" },
  { name: "/arl", hint: "auto RL · browse|list · on|off|status" },
  { name: "/refine", hint: "arl learn · falsify · convergent · deploy · preship" },
  { name: "/factory", hint: "subagent DAG · run|status|list|stop|import" },
  { name: "/mission", hint: "<goal> · status · stop · done" },
  { name: "/decision", hint: "mission choose engine (prefer /mission)" },
  { name: "/permissions", hint: "mode, session always, saved rules" },
  { name: "/exit", hint: "leave" },
]

/** Cold-start popularity (higher = more used). Unknown names get 0. */
const DEFAULT_POPULARITY: Record<string, number> = {
  "/help": 100,
  "/status": 95,
  "/mode": 90,
  "/provider": 88,
  "/model": 86,
  "/web": 84,
  "/mission": 82,
  "/doctor": 80,
  "/new": 78,
  "/compact": 76,
  "/undo": 74,
  "/context": 72,
  "/chats": 70,
  "/open": 68,
  "/arl": 66,
  "/refine": 64,
  "/spawn": 62,
  "/agents": 60,
  "/daemon": 58,
  "/codemode": 56,
  "/stance": 54,
  "/config": 52,
  "/permissions": 50,
  "/key": 48,
  "/temp": 46,
  "/notify": 44,
  "/sound": 42,
  "/factory": 40,
  "/steer": 38,
  "/image": 36,
  "/copy": 34,
  "/url": 32,
  "/rename": 30,
  "/delete": 28,
  "/history": 26,
  "/investigate": 24,
  "/turn": 22,
  "/evidence": 20,
  "/decision": 18,
  "/exit": 10,
}

const USAGE_KEY = "axi.web.slashUsage"

type UsageMap = Record<string, number>

function readUsage(): UsageMap {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(USAGE_KEY)
    if (!raw) return {}
    const j = JSON.parse(raw) as unknown
    if (!j || typeof j !== "object") return {}
    const out: UsageMap = {}
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.floor(v)
    }
    return out
  } catch {
    return {}
  }
}

function writeUsage(map: UsageMap): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode */
  }
}

/** Bump usage for a command token (e.g. `/status`). */
export function recordSlashUsage(nameOrLine: string): void {
  const token = (nameOrLine.trim().split(/\s/)[0] ?? "").trim()
  if (!token.startsWith("/") || token === "/") return
  const map = readUsage()
  map[token] = (map[token] ?? 0) + 1
  writeUsage(map)
}

function score(name: string, usage: UsageMap): number {
  // Live usage dominates; default popularity breaks ties / cold start.
  return (usage[name] ?? 0) * 1000 + (DEFAULT_POPULARITY[name] ?? 0)
}

function sortByUsage(rows: SlashCommand[]): SlashCommand[] {
  const usage = readUsage()
  return [...rows].sort((a, b) => {
    const d = score(b.name, usage) - score(a.name, usage)
    if (d !== 0) return d
    return a.name.localeCompare(b.name)
  })
}

/** Prefix-match on the first token. Bare `/` matches everything. */
export function slashMatches(draft: string): SlashCommand[] {
  const d = draft.trimEnd()
  if (!d.startsWith("/")) return []
  const cmd = d.split(/\s/)[0] ?? d
  if (cmd === "/") return sortByUsage(SLASH_COMMANDS)
  return sortByUsage(SLASH_COMMANDS.filter((s) => s.name.startsWith(cmd)))
}

/** Rows to paint above the composer (unknown token → single “unknown” row). */
export function slashHintRows(draft: string): SlashCommand[] {
  const t = draft.trimEnd()
  if (!t.startsWith("/")) return []
  // Bare `/` → full catalog (most → least used).
  if (t === "/") return slashMatches("/")
  const hits = slashMatches(t)
  if (hits.length) return hits
  const token = t.split(/\s/)[0] ?? t
  return [{ name: token, hint: "unknown" }]
}

/** Replace the command token; keep any args. Adds a trailing space when there were none. */
export function completeSlashToken(draft: string, name: string): string {
  const sp = draft.indexOf(" ")
  const args = sp >= 0 ? draft.slice(sp) : ""
  return args.startsWith(" ") ? `${name}${args}` : `${name} `
}

/** True when the submit line should run as a slash (not an agent turn). */
export function isSlashLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith("/") && t !== "/"
}
