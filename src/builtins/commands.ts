/**
 * CLI + slash command specs — data only.
 * Dispatch lives in core/commands; do not put leaf logic here.
 */

export type CliKind =
  | "help"
  | "version"
  | "agent"
  | "ask"
  | "chat"
  | "doctor"
  | "spawn"
  | "provider"
  | "mission"
  | "daemon"
  | "agents"

export type CliSpec = {
  kind: CliKind
  /** First argv tokens that select this command (empty = default / bare `axi`). */
  tokens: string[]
  usage: string
  summary: string
  /** Extra usage lines shown in help. */
  details?: string[]
}

export type SlashSpec = {
  name: string
  hint: string
  aliases?: string[]
}

export const CLI_SPECS: CliSpec[] = [
  {
    kind: "agent",
    tokens: ["", "agent"],
    usage: "axi",
    summary: "chat (TTY)",
    details: ["axi                 chat (TTY)", "axi agent           same"],
  },
  {
    kind: "chat",
    tokens: ["chat"],
    usage: "axi chat [list|last|<id>|new]",
    summary: "list or resume chats",
    details: [
      "axi chat list       previous chats",
      "axi chat last       resume the latest",
      "axi chat <id>       resume that chat",
    ],
  },
  {
    kind: "ask",
    tokens: ["ask"],
    usage: "axi ask [-y] [--json] [dir] <prompt>",
    summary: "one-shot answer (no chat UI)",
    details: [
      "axi ask [dir] <prompt>   one-shot answer (no chat UI)",
      "axi ask --json [dir] <prompt>",
    ],
  },
  {
    kind: "help",
    tokens: ["help", "-h", "--help"],
    usage: "axi help",
    summary: "this text",
    details: ["axi help            this text"],
  },
  {
    kind: "version",
    tokens: ["version", "-v", "--version"],
    usage: "axi version [--verbose] [--json]",
    summary: "agent version",
    details: ["axi version         agent version (-v / --version; version --verbose for paths)"],
  },
  {
    kind: "provider",
    tokens: ["provider"],
    usage: "axi provider [list|<name>|use <name>] [--json]",
    summary: "list or set model providers",
    details: [
      "axi provider        list openai / anthropic / grok / ollama",
      "axi provider <name> save key (hidden) and use it",
      "axi provider use <name>  switch",
    ],
  },
  {
    kind: "doctor",
    tokens: ["doctor"],
    usage: "axi doctor [--json] [dir]",
    summary: "health check (agent, provider, workspace, skills, mcp, aq)",
    details: ["axi doctor [dir]    health check (agent, provider, workspace, skills, mcp, aq)"],
  },
  {
    kind: "mission",
    tokens: ["mission"],
    usage: "axi mission tick|status|rebuild-index",
    summary: "mission pulse tick (durable schedules when chat is closed)",
    details: [
      "axi mission tick         mark due pulses (~/.axi/pulse-jobs.json)",
      "axi mission status [id]  list pulse jobs or one chat mission",
      "axi mission rebuild-index  rescan chats into the pulse index",
    ],
  },
  {
    kind: "spawn",
    tokens: ["spawn"],
    usage: "axi spawn agent|list|log|cancel …",
    summary: "worker agents",
    details: [
      "axi spawn agent [dir] -- <prompt>  start a worker agent",
      "axi spawn agent --kill -- <prompt>  critic: cheapest disproof",
      "axi spawn list [dir]",
      "axi spawn log [dir] <id>",
      "axi spawn cancel [dir] <id>",
    ],
  },
  {
    kind: "daemon",
    tokens: ["daemon"],
    usage: "axi daemon start|stop|status|run",
    summary: "background supervisor (pulse/factory ticks; spawn host)",
    details: [
      "axi daemon start    detach supervisor",
      "axi daemon stop",
      "axi daemon status",
      "axi daemon run      foreground",
    ],
  },
  {
    kind: "agents",
    tokens: ["agents"],
    usage: "axi agents [dir] [--parent <chatId>]",
    summary: "agents roster + daemon status",
    details: [
      "axi agents [dir]                 list workers",
      "axi agents [dir] --parent <id>   children of a chat",
    ],
  },
]

export const SLASH_SPECS: SlashSpec[] = [
  { name: "/help", hint: "commands" },
  { name: "/new", hint: "start a new chat", aliases: ["/newchat"] },
  { name: "/rename", hint: "rename this chat", aliases: ["/name"] },
  { name: "/chats", hint: "list chats" },
  { name: "/open", hint: "open a chat by name or id", aliases: ["/chat"] },
  { name: "/url", hint: "open URL · bare hosts get https://" },
  { name: "/copy", hint: "copy last reply (or text) to clipboard" },
  { name: "/delete", hint: "delete this chat · /delete all" },
  { name: "/compact", hint: "summarize older messages" },
  { name: "/undo", hint: "undo last agent turn" },
  { name: "/image", hint: "attach an image by path", aliases: ["/img"] },
  { name: "/context", hint: "context window use" },
  { name: "/status", hint: "session snapshot · tokens / cache-hit / ~$" },
  { name: "/doctor", hint: "health check" },
  { name: "/spawn", hint: "worker agents · cancel <id> <why>" },
  { name: "/agents", hint: "live agents view · list for text board" },
  { name: "/daemon", hint: "background supervisor · status|start|stop" },
  { name: "/provider", hint: "openai · anthropic · grok · ollama" },
  { name: "/model", hint: "set model id" },
  { name: "/temp", hint: "sampling temperature 0–2 · /temp show|reset", aliases: ["/temperature"] },
  { name: "/key", hint: "paste an api key · /api", aliases: ["/api"] },
  { name: "/sound", hint: "on · off" },
  { name: "/notify", hint: "on · off · reply desktop alerts" },
  { name: "/mode", hint: "ask · auto · plan · full-access (permission mode)" },
  { name: "/codemode", hint: "sticky Node scratchpad · on|off|status · reset · stop" },
  { name: "/stance", hint: "explore · execute · challenge · status · unpin (judgment mode)" },
  { name: "/investigate", hint: "hypothesis graph · status|add|link|abandon|clear" },
  { name: "/arl", hint: "auto RL · on|off|status · interval · cooldown · compact" },
  { name: "/refine", hint: "arl: learn from this chat · [--global] [focus] · rollback <id>" },
  { name: "/factory", hint: "subagent DAG · run|status|list|stop|import|log|cancel <node> <why>" },
  { name: "/mission", hint: "<goal> · status · stop · done" },
  { name: "/decision", hint: "mission choose engine (prefer /mission)" },
  { name: "/permissions", hint: "mode, session always, saved rules", aliases: ["/perms"] },
  { name: "/exit", hint: "leave", aliases: ["/quit"] },
]

export const HELP_INTRO = [
  "axi  chat · ask · spawn",
  "",
  "Coding / research agent for the current folder.",
  "Model train / eval / fleet: aq CLI when cwd (or a child) has recipe.yaml.",
] as const

export const HELP_OUTRO = [
  "",
  "Framework (optional): aq train | eval | jobs | …",
  "  Docs: https://aq.aquin.app/docs",
] as const

export function matchCliKind(token: string | undefined): CliKind | null {
  if (token == null || token === "") return "agent"
  for (const spec of CLI_SPECS) {
    if (spec.tokens.includes(token)) return spec.kind
  }
  return null
}

export function slashAliasMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const s of SLASH_SPECS) {
    for (const a of s.aliases ?? []) map[a] = s.name
  }
  return map
}
