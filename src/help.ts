/** Help for the standalone axi package. */

export function help(): string {
  return [
    "axi  chat · ask · spawn",
    "",
    "Train / eval / jobs / fleet: the aq CLI (AQ_ROOT / AQ_BIN).",
    "",
    "  axi                 chat (TTY)",
    "  axi agent           same",
    "  axi chat list       previous chats",
    "  axi chat last       resume the latest",
    "  axi chat <id>       resume that chat",
    "  axi ask [dir] <prompt>   one-shot answer (no chat UI)",
    "  axi ask --json [dir] <prompt>",
    "  axi help            this text",
    "  axi version         agent version (-v / --version; version --verbose for paths)",
    "  axi provider        list openai / anthropic / grok / ollama",
    "  axi provider <name> save key (hidden) and use it",
    "  axi provider use <name>  switch",
    "  axi doctor [dir]    health check (agent, provider, train, skills, mcp, aq framework)",
    "  axi spawn agent [dir] -- <prompt>  start a worker agent",
    "  axi spawn agent --kill -- <prompt>  critic: cheapest disproof",
    "  axi spawn list [dir]",
    "  axi spawn log [dir] <id>",
    "  axi spawn cancel [dir] <id>",
    "",
    "Framework (install separately): aq train | eval | jobs | …",
    "  Docs: https://aq.aquin.app/docs",
  ].join("\n")
}
