#!/usr/bin/env node
/**
 * Emit static GitHub Pages docs under docs/ (same chrome as aq).
 * Run: node scripts/build-docs.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs")

const NAV = [
  { href: "./", label: "Getting started", id: "home" },
  { href: "install/", label: "Install", id: "install" },
  { href: "chat/", label: "Chat", id: "chat" },
  { href: "cli/", label: "CLI reference", id: "cli" },
  { href: "provider/", label: "Provider & keys", id: "provider" },
  { href: "permissions/", label: "Permissions", id: "permissions" },
  { href: "slash/", label: "Slash commands", id: "slash" },
  { section: "Product" },
  { href: "mission/", label: "Mission", id: "mission", nested: true },
  { href: "arl/", label: "arl (auto RL)", id: "arl", nested: true },
  { href: "daemon/", label: "Daemon & agents", id: "daemon", nested: true },
  { href: "factory/", label: "Factory", id: "factory", nested: true },
  { href: "skills/", label: "Skills, tools & MCP", id: "skills", nested: true },
]

function assetPrefix(depth) {
  return "../".repeat(depth) + "assets"
}
function docPrefix(depth) {
  // from documentation/<page>/ → documentation/
  if (depth === 1) return "./"
  return "../".repeat(depth - 1)
}
function changelogHref(depth) {
  return "../".repeat(depth) + "changelog/"
}
function liveDocsHref() {
  return "https://aquinf03.github.io/axi/documentation/"
}

function navHtml(active, depth) {
  const docs = docPrefix(depth)
  const lines = [
    `<a class="nav-link" href="${liveDocsHref()}" rel="noopener">Live docs</a>`,
  ]
  for (const item of NAV) {
    if (item.section) {
      lines.push(`<p class="nav-section">${item.section}</p>`)
      continue
    }
    const href =
      item.id === "home"
        ? docs
        : depth === 1
          ? item.href
          : docs + item.href
    const cls = [
      "nav-link",
      item.nested ? "nested" : "",
      item.id === active ? "active" : "",
    ]
      .filter(Boolean)
      .join(" ")
    lines.push(`<a class="${cls}" href="${href}">${item.label}</a>`)
  }
  return lines.join("\n")
}

function shellBlock(label, lines) {
  const body = lines
    .map((l) => {
      const t = l.replace(/^\$\s?/, "")
      return `<span class="line"><span class="prompt">$</span><span>${esc(t)}</span></span>`
    })
    .join("\n")
  return `<div class="codeblock" data-shell="1">
  <div class="codeblock-bar">
    <span>${esc(label)}</span>
    <button type="button" class="copy-btn">Copy</button>
  </div>
  <pre><code>${body}</code></pre>
</div>`
}

function codeBlock(label, lines) {
  const body = lines.map((l) => `<span class="line"><span>${esc(l)}</span></span>`).join("\n")
  return `<div class="codeblock" data-shell="0">
  <div class="codeblock-bar">
    <span>${esc(label)}</span>
    <button type="button" class="copy-btn">Copy</button>
  </div>
  <pre><code>${body}</code></pre>
</div>`
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function chip(s) {
  return `<code class="chip">${esc(s)}</code>`
}

function table(headers, rows) {
  const th = headers.map((h) => `<th>${h}</th>`).join("")
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td${i === 0 ? ' class="mono"' : ""}>${c}</td>`)
          .join("")}</tr>`,
    )
    .join("\n")
  return `<div class="table-wrap mb">
    <table class="plain">
      <thead><tr>${th}</tr></thead>
      <tbody>
${body}
      </tbody>
    </table>
  </div>`
}

function toolSection(id, cmd, desc, { flags, examples } = {}) {
  let html = `<section class="tool" id="${id}">
  <h3 class="tool-cmd">${esc(cmd)}</h3>
  <p class="tool-desc">${desc}</p>`
  if (flags?.length) {
    html += `
  <div class="table-wrap mb">
  <table>
    <thead><tr><th>Flag</th><th>Description</th></tr></thead>
    <tbody>${flags
      .map(
        ([f, d]) => `<tr>
  <td class="flag">${esc(f)}</td>
  <td>${d}</td>
</tr>`,
      )
      .join("\n")}</tbody>
  </table>
</div>`
  }
  for (const ex of examples || []) {
    html += "\n" + shellBlock(ex.label || "example", ex.lines)
  }
  html += "\n</section>"
  return html
}

function page({ title, description, active, depth, body, h1Class }) {
  const assets = assetPrefix(depth)
  const docsHome = docPrefix(depth)
  const cl = changelogHref(depth)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} · axi Docs</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="icon" href="${assets}/favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${assets}/docs.css" />
</head>
<body>
  <header class="docs-header">
    <div class="docs-header-inner">
      <a class="brand" href="${docsHome}" title="Aquin Labs">
        <img src="${assets}/mainlogo2.png" alt="" width="22" height="22" />
        <span>Aquin<span class="brand-gap">Labs</span></span>
      </a>
      <div class="header-actions">
        <a class="header-link" href="${docsHome}">Docs</a>
        <a class="header-link" href="${cl}">Changelog</a>
        <a class="header-cta" href="https://github.com/Aquinf03/axi" rel="noopener">GitHub</a>
      </div>
    </div>
  </header>
  <div class="docs-frame">
    <aside class="docs-sidebar" aria-label="Documentation">
    <nav>${navHtml(active, depth)}
</nav>
    </aside>
    <main class="docs-main">${body}
    </main>
  </div>
  <script src="${assets}/docs.js"></script>
</body>
</html>
`
}

function write(rel, html) {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, html)
  console.log("wrote", rel)
}

// ── pages ──────────────────────────────────────────────────────────

write(
  "index.html",
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0; url=documentation/" />
  <link rel="canonical" href="documentation/" />
  <title>axi Docs</title>
  <script>location.replace("documentation/");</script>
</head>
<body>
  <p><a href="documentation/">Continue to documentation</a> · <a href="changelog/">Changelog</a></p>
</body>
</html>
`,
)

write(
  "documentation/index.html",
  page({
    title: "Getting started with axi",
    description:
      "axi is the coding / research agent for the current folder. TTY chat, ask, mission, arl, daemon. Train/eval stay in aq.",
    active: "home",
    depth: 1,
    body: `<article>
  <h1 class="hero">Getting started</h1>
  <p class="lead"><strong>axi</strong> is the coding / research agent for the folder you are in. Chats, keys, and memory live under ${chip("~/.axi")}. Model <strong>train / eval / fleet</strong> stay in the separate <strong>aq</strong> package — axi shells out to ${chip("aq")} when cwd (or a child) has ${chip("recipe.yaml")}.</p>

  <h2>How the pieces fit</h2>
  ${table(
    ["Name", "What it is"],
    [
      [chip("axi"), "This package — TTY agent, ask, mission, arl, daemon, factory."],
      [chip("aq"), "Framework CLI + kernel (separate repo). Train / eval / jobs / fleet."],
      [chip("~/.axi"), "Profile: chats, keys, settings, arl harness, daemon socket."],
      [chip("recipe.yaml"), "Marks a train folder — axi unlocks aq_* tools against it."],
    ],
  )}

  <h2>Quick start</h2>
  ${shellBlock("shell", [
    "$ curl -fsSL https://aquin.app/axi/download/install.sh | bash",
    "$ axi provider openai",
    "$ cd /path/to/project",
    "$ axi",
  ])}
  <p class="lead">Needs <strong>Node ≥ 18</strong>. Configure a provider once, then chat in any folder. Optional: install <a href="https://aquinf03.github.io/aq/documentation/" rel="noopener">aq</a> and set ${chip("AQ_ROOT")} for train tools.</p>

  <h2>What you can do</h2>
  ${table(
    ["Surface", "Entry"],
    [
      ["TTY chat", `${chip("axi")} · slash menus · permits`],
      ["One-shot", `${chip("axi ask")} [-y] [--json] <prompt>`],
      ["Mission keep-going", `${chip("/mission <goal>")} · daemon continues when chat closes`],
      ["Self-improve", `${chip("/arl on")} · ${chip("/refine")}`],
      ["Background", `${chip("axi daemon start")} · spawn · factory`],
    ],
  )}

  <h2>Next</h2>
  <p class="lead"><a href="install/">Install</a> · <a href="chat/">Chat</a> · <a href="cli/">CLI</a> · <a href="mission/">Mission</a> · <a href="arl/">arl</a> · <a href="../changelog/">Changelog</a></p>
</article>`,
  }),
)

write(
  "documentation/install/index.html",
  page({
    title: "Install",
    description: "Install axi via curl (Cloudflare R2) or from a checkout. Node ≥ 18. Optional aq for train tools.",
    active: "install",
    depth: 2,
    body: `<h1>Install</h1>
<p class="lead">Same publish path as aq: tarball on Cloudflare R2, install script on <code class="chip">aquin.app</code>. Needs Node ≥ 18. After install, run ${chip("axi doctor")}.</p>
<div class="prereq"><span class="prereq-label">Prerequisite</span>Node ≥ 18 · npm · curl · (optional) aq for train tools</div>
${toolSection("curl", "curl … | bash", "Team install — downloads <code>axi-latestv.tar.gz</code> from <code>aquin.app/releases</code> and links <code>axi</code> under <code>~/.local</code>.", {
  examples: [
    {
      lines: [
        "$ curl -fsSL https://aquin.app/axi/download/install.sh | bash",
        "$ axi version",
        "$ axi doctor",
      ],
    },
  ],
})}
${toolSection("from-source", "npm i && npm link", "Install from an axi checkout (or <code>./install.sh</code> in the repo).", {
  examples: [
    { lines: ["$ cd axi && npm i && npm link", "$ axi version", "$ axi doctor"] },
    { lines: ["$ cd axi && ./install.sh"] },
  ],
})}
${toolSection("provider", "axi provider <name>", "Save a provider key and select it. Names: openai · anthropic · grok · ollama.", {
  examples: [
    { lines: ["$ axi provider openai", "$ axi provider use anthropic", "$ axi provider list"] },
  ],
})}
${toolSection("aq-bridge", "AQ_ROOT / AQ_BIN", "Point axi at an aq install so train tools work inside recipe.yaml folders.", {
  flags: [
    ["AQ_ROOT", "Path to the aq package (contains bin/aq)."],
    ["AQ_BIN", "Path to the aq binary."],
    ["sibling ../aq", "Also discovered if axi and aq checkouts sit next to each other."],
  ],
  examples: [{ lines: ["$ export AQ_ROOT=/path/to/aq", "$ axi doctor"] }],
})}
<h2>Profile</h2>
<p class="lead">First run creates ${chip("~/.axi")}. An older ${chip("~/.aq")} agent profile is migrated when present. Keys and settings never belong in the project tree — project ${chip(".axi.json")} is repo-safe keys only.</p>
${codeBlock("~/.axi", [
  "~/.axi/",
  "  config.json          providers, keys, sound, notify",
  "  settings.json        permission mode, saved rules",
  "  chats/<id>/          messages, mission, arl, factory",
  "  arl/                 global harness + pending deploy",
  "  daemon/              sock, pid, log",
  "  backups/             config dry-run backups",
])}
`,
  }),
)

write(
  "documentation/chat/index.html",
  page({
    title: "Chat",
    description: "TTY chat: composer, slash menus, permits, steer, mission kicks.",
    active: "chat",
    depth: 2,
    body: `<h1>Chat</h1>
<p class="lead">Interactive agent on a TTY. Chat and ${chip("/")} menus stay in normal scrollback. Permission pickers and confirms use the alternate screen.</p>
${shellBlock("shell", ["$ axi", "$ axi chat last", "$ axi chat <id>"])}
<h2>Composer</h2>
<ul>
  <li>Type to chat · ${chip("/")} opens settings / slash hints</li>
  <li>While the agent is busy: type + enter <strong>queues</strong> a message; ${chip("esc")} / ${chip("ctrl-c")} aborts the turn (${chip("/steer")})</li>
  <li>${chip("/image <path>")} attaches an image for the next user turn</li>
  <li>${chip("/copy")} · ${chip("/url")} go through the host (clipboard / open URL)</li>
</ul>
<h2>Permits</h2>
<p class="lead">Sensitive tools ask once / always / deny. ${chip("plan")} mode is fail-closed read-only. See <a href="../permissions/">Permissions</a>.</p>
<h2>Sessions</h2>
<p class="lead">Portable ids under ${chip("~/.axi/chats/<id>/")} with ${chip("workspace_root")}. Spawn workers are child sessions (hidden from the normal chat list).</p>
`,
  }),
)

write(
  "documentation/cli/index.html",
  page({
    title: "CLI reference",
    description: "axi CLI: chat, ask, provider, doctor, spawn, daemon, mission, agents.",
    active: "cli",
    depth: 2,
    body: `<h1>CLI reference</h1>
<p class="lead">Quiet, cwd-based. Default command is TTY chat.</p>
${toolSection("axi", "axi · axi agent", "Open interactive chat in the current folder.", {
  examples: [{ lines: ["$ axi"] }],
})}
${toolSection("ask", "axi ask [-y] [--json] [dir] <prompt>", "One-shot answer without the chat UI.", {
  flags: [
    ["-y / --yes", "Auto-approve mutating tools (full-access for this ask)."],
    ["--json", "Emit text, tools, usage, harness."],
    ["--auto / --full-access / --mode", "Permission mode for this ask."],
  ],
  examples: [
    { lines: ['$ axi ask "how does src/cli.ts wire commands?"'] },
    { lines: ['$ axi ask -y --json "run doctor and summarize"'] },
  ],
})}
${toolSection("chat", "axi chat [list|last|<id>|new]", "List or resume chats under ~/.axi/chats/.", {
  examples: [{ lines: ["$ axi chat list", "$ axi chat last"] }],
})}
${toolSection("provider", "axi provider [list|<name>|use <name>]", "List or set model providers (openai · anthropic · grok · ollama).", {
  examples: [{ lines: ["$ axi provider", "$ axi provider openai"] }],
})}
${toolSection("doctor", "axi doctor [--json] [dir]", "Health check: agent, provider, workspace, skills, mcp, aq bridge.", {
  examples: [{ lines: ["$ axi doctor"] }],
})}
${toolSection("spawn", "axi spawn agent|list|log|cancel …", "Background worker agents. Cancel requires a why (prune-with-receipt).", {
  examples: [
    { lines: ['$ axi spawn agent -- "investigate flaky test"', "$ axi spawn list"] },
  ],
})}
${toolSection("daemon", "axi daemon start|stop|status|run", "Background supervisor: mission keep-going, pulse, factory, spawn host.", {
  examples: [{ lines: ["$ axi daemon start", "$ axi daemon status"] }],
})}
${toolSection("mission-cli", "axi mission tick|status|rebuild-index", "Mark due pulses / inspect mission when chat is closed.", {
  examples: [{ lines: ["$ axi mission tick", "$ axi mission status"] }],
})}
${toolSection("agents", "axi agents [dir] [--parent <chatId>]", "Text roster of workers + daemon status. In chat, /agents opens the live TUI.", {
  examples: [{ lines: ["$ axi agents"] }],
})}
${toolSection("version", "axi version [--verbose] [--json]", "Print agent version (and paths with --verbose).", {
  examples: [{ lines: ["$ axi version"] }],
})}
`,
  }),
)

write(
  "documentation/provider/index.html",
  page({
    title: "Provider & keys",
    description: "Configure openai, anthropic, grok, or ollama. Keys in ~/.axi/config.json.",
    active: "provider",
    depth: 2,
    body: `<h1>Provider &amp; keys</h1>
<p class="lead">Providers: <strong>openai</strong> · <strong>anthropic</strong> · <strong>grok</strong> · <strong>ollama</strong>. Keys and model selection live in ${chip("~/.axi/config.json")} (gated by ${chip("/config")} dry-run when enabled).</p>
${shellBlock("shell", [
  "$ axi provider list",
  "$ axi provider openai",
  "$ axi provider use anthropic",
  "$ axi model gpt-4.1",
])}
<h2>In chat</h2>
<ul>
  <li>${chip("/provider")} · ${chip("/model")} · ${chip("/key")} · ${chip("/temp")}</li>
  <li>${chip("/status")} — tokens in/out/cached, cache-hit %, ~$ for last turn + chat</li>
  <li>${chip("/sound")} · ${chip("/notify")} — cues and desktop reply alerts</li>
</ul>
<p class="lead">Config writes stage for approve by default — ${chip("/config status|approve|deny")}. Bypass for scripts: ${chip("AXI_CONFIG_APPLY=immediate")}.</p>
`,
  }),
)

write(
  "documentation/permissions/index.html",
  page({
    title: "Permissions",
    description: "ask · auto · plan · full-access. Tool text is evidence only — never a grant.",
    active: "permissions",
    depth: 2,
    body: `<h1>Permissions</h1>
<p class="lead">Every sensitive tool goes through ${chip("authorizeTool")}. Tool / model text is <strong>evidence only</strong> — never a grant or mode change.</p>
${table(
  ["Mode", "Behavior"],
  [
    [chip("ask"), "Prompt once / always / deny for sensitive tools (default)."],
    [chip("auto"), "Approve matching session/saved rules; still ask when unsure."],
    [chip("plan"), "Fail-closed read-only — write/run blocked even if you would approve."],
    [chip("full-access"), "Auto-yes (yolo alias). Use sparingly."],
  ],
)}
<p class="lead">Set via ${chip("/mode")}, ${chip("AXI_PERMISSION_MODE")}, or profile settings. Saved rules: ${chip("~/.axi/settings.json")}. Session ${chip("always")} is non-persistent.</p>
${shellBlock("shell", ["$ axi ask --mode plan \"review src/cli.ts\"", "$ axi ask -y \"apply the fix\""])}
`,
  }),
)

write(
  "documentation/slash/index.html",
  page({
    title: "Slash commands",
    description: "In-chat slash commands for mission, arl, steer, factory, and more.",
    active: "slash",
    depth: 2,
    body: `<h1>Slash commands</h1>
<p class="lead">Type ${chip("/")} in the composer. Hints appear under the prompt.</p>
${table(
  ["Command", "Hint"],
  [
    ["/help", "commands"],
    ["/new · /chats · /open · /rename · /delete", "session"],
    ["/compact · /undo · /context · /status · /doctor", "session health"],
    ["/provider · /model · /key · /temp · /mode · /config", "setup"],
    ["/mission · /decision", "keep-going / choose"],
    ["/arl · /refine · /turn", "auto RL + trajectory"],
    ["/steer", "pause · inject · redirect · queue · abort"],
    ["/stance · /investigate · /revise · /pivot", "judgment"],
    ["/evidence · /reconcile · /ledger · /audit", "claim quality"],
    ["/codemode · /factory · /spawn · /agents · /daemon", "workers"],
    ["/image · /copy · /url · /permissions · /exit", "host + assets"],
  ].map(([a, b]) => [`<code>${a}</code>`, b]),
)}
<p class="lead">Full specs live in ${chip("src/builtins/commands.ts")} — single source for help and menus.</p>
`,
  }),
)

write(
  "documentation/mission/index.html",
  page({
    title: "Mission",
    description: "Objective / Drive / Pulse / Choose — keep working when the human goes quiet.",
    active: "mission",
    depth: 2,
    body: `<h1>Mission</h1>
<p class="lead">Keep working when the human goes quiet — <strong>one product</strong>, four engines. Persist ${chip("~/.axi/chats/<id>/mission.json")}.</p>
${table(
  ["Slash", "Effect"],
  [
    [`${chip("/mission <goal>")}`, "Start — sets objective + light drive"],
    [`${chip("/mission")}`, "Status"],
    [`${chip("/mission stop")}`, "Stop objective, drive, pulse, choose"],
    [`${chip("/mission done")}`, "Mark goal finished (ledger / residual gates apply)"],
    [`${chip("/mission advanced")}`, "Drive / pulse / budget power path"],
  ],
)}
<h2>Engines</h2>
${table(
  ["Engine", "Role"],
  [
    ["Objective", "Re-inject + no-progress backoff · mission_done"],
    ["Drive", "Bounded keep-going + optional shell gates"],
    ["Pulse", "Wall-clock wakes · durable pulse-jobs index"],
    ["Choose", "observe → decide → act loop (mission.choose)"],
  ],
)}
<h2>Daemon product</h2>
<p class="lead">With ${chip("axi daemon")} up, objective / drive / backoff kicks and choose ticks continue after the TUI closes. Continuations persist as ${chip("pendingKick")}; the daemon runs a headless parent turn. Pulse still delivers as a spawn child. Open chat yields when the daemon is up.</p>
${shellBlock("shell", ["$ axi daemon start", "$ axi mission status"])}
`,
  }),
)

write(
  "documentation/arl/index.html",
  page({
    title: "arl (auto RL)",
    description: "Continual harness: digest, /refine, falsify, convergent, deploy, evidence.",
    active: "arl",
    depth: 2,
    body: `<h1>arl (auto RL)</h1>
<p class="lead">Continual harness for reusable lessons across turns — without rewriting the base personality every time. Front door ${chip("core/arl.ts")}. Default <strong>off</strong>.</p>
${shellBlock("chat", ["$ /arl on", "$ /refine", "$ /refine --global", "$ /refine deploy approve"])}
<h2>Core ideas</h2>
<ul>
  <li><strong>Digest</strong> — ranked ${chip("[arl-digest]")} user row at cold boundaries (start, compact, ask)</li>
  <li><strong>Kinds</strong> — prompt · memory · rejected · skill · subagent · policy</li>
  <li><strong>Refine</strong> — plan + apply harness edits; agent schedules, host applies end-of-turn</li>
  <li><strong>Rejected</strong> — file-drawer negatives (tried + why) so dead ends are not rediscovered</li>
</ul>
<h2>Gates (defaults on)</h2>
${table(
  ["Gate", "Slash"],
  [
    ["Falsify — what would disprove the lesson", chip("/refine falsify")],
    ["Convergent — N corroborations for global lessons", chip("/refine convergent")],
    ["Deploy — stage global ship for approve", chip("/refine deploy")],
    ["Preship — harness fingerprint + structural eval", chip("/refine preship")],
    ["Evidence · reconcile · ledger · residual", "/evidence · /reconcile · /ledger · /audit"],
  ],
)}
<p class="lead">Global harness: ${chip("~/.axi/arl/")}. Per chat: ${chip("~/.axi/chats/<id>/arl/")}. Trajectory signals (${chip("/turn")} accept/edit/undo/retry/deny) arm auto-refine.</p>
`,
  }),
)

write(
  "documentation/daemon/index.html",
  page({
    title: "Daemon & agents",
    description: "Background supervisor: mission keep-going, pulse, factory, spawn host.",
    active: "daemon",
    depth: 2,
    body: `<h1>Daemon &amp; agents</h1>
<p class="lead">Background supervisor so work continues when the TUI is closed. Socket + pid under ${chip("~/.axi/daemon/")}.</p>
${shellBlock("shell", [
  "$ axi daemon start",
  "$ axi daemon status",
  "$ axi agents",
  "$ axi daemon stop",
])}
<h2>Tick (~2s)</h2>
<ul>
  <li>Mark due pulses + objective backoffs</li>
  <li>Deliver parent keep-going turns (${chip("pendingKick")})</li>
  <li>Choose-loop ticks for ${chip("mission.choose")} left running</li>
  <li>Pulse spawn children · factory DAG ticks</li>
</ul>
<p class="lead">When up, ${chip("startAgent")} / spawn prefer the daemon. Force local: ${chip("AXI_DAEMON=0")}.</p>
<h2>Agents view</h2>
<p class="lead">${chip("/agents")} opens a live multi-agent TUI (daemon status, this-chat + workspace, filter, log/cancel). ${chip("/agents list")} keeps the text board. ${chip("axi agents")} from the shell.</p>
`,
  }),
)

write(
  "documentation/factory/index.html",
  page({
    title: "Factory",
    description: "Subagent DAG: when / foreach / loop, MACHINE.md, live dock.",
    active: "factory",
    depth: 2,
    body: `<h1>Factory</h1>
<p class="lead">DAG of spawned subagents. Front door ${chip("core/factory.ts")}. Persist ${chip("~/.axi/chats/<id>/factory.json")} — one run per chat.</p>
${shellBlock("chat", [
  "$ /factory run builder",
  "$ /factory status",
  "$ /factory log <node>",
  "$ /factory cancel <node> <why>",
])}
<h2>Spec shape</h2>
${codeBlock("machine", [
  '{ "name": "builder", "max_parallel": 2,',
  '  "nodes": [',
  '    { "id": "plan", "prompt": "…" },',
  '    { "id": "impl", "needs": ["plan"], "prompt": "Use {plan}" }',
  "  ] }",
])}
<ul>
  <li><strong>when</strong> — skip if guard fails</li>
  <li><strong>foreach</strong> — expand over a JSON list</li>
  <li><strong>loop</strong> — re-run until until-guard passes</li>
  <li><strong>MACHINE.md</strong> — frontmatter + fenced machine-spec JSON</li>
</ul>
<p class="lead">Seeds: ${chip("builder")}, ${chip("review")}, ${chip("retry-merge")}, ${chip("review-sweep")}. User machines: ${chip("~/.axi/factory/machines/")}. Live dock paints above the composer while a run exists.</p>
`,
  }),
)

write(
  "documentation/skills/index.html",
  page({
    title: "Skills, tools & MCP",
    description: "Core tools, deferred tools, skills packs, MCP extras.",
    active: "skills",
    depth: 2,
    body: `<h1>Skills, tools &amp; MCP</h1>
<p class="lead">Core tools are always offered. Deferred tools (${chip("aq_*")}, spawn, plot, memory, factory, …) appear after ${chip("tools_search")} loads them for the session. Discover ≠ authorize.</p>
${table(
  ["Layer", "Examples"],
  [
    ["Core", "read · edit · write · run · grep · web · view · tools_search"],
    ["Deferred", "aq_train · spawn · codemode_run · factory_* · memory_*"],
    ["MCP / skills", "extras from skills packs and MCP servers"],
  ],
)}
<p class="lead">Schemas: ${chip("src/core/tooling/tool_specs.ts")}. Implementations: ${chip("src/tools/")}. Prefer ${chip("view")} over ${chip("read")} for images.</p>
<p class="lead">${chip("axi doctor")} reports skills + MCP health for the workspace.</p>
`,
  }),
)

// changelog
const clBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>axi changelog · Aquin Labs</title>
  <meta name="description" content="What's new in axi. Run axi version to see what you have installed." />
  <link rel="icon" href="../assets/favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/docs.css" />
</head>
<body class="cl-page">
  <header class="docs-header">
    <div class="docs-header-inner">
      <a class="brand" href="../documentation/" title="Aquin Labs">
        <img src="../assets/mainlogo2.png" alt="" width="22" height="22" />
        <span>Aquin<span class="brand-gap">Labs</span></span>
      </a>
      <div class="header-actions">
        <a class="header-link" href="../documentation/">Docs</a>
        <a class="header-link" href="./">Changelog</a>
        <a class="header-cta" href="https://github.com/Aquinf03/axi" rel="noopener">GitHub</a>
      </div>
    </div>
  </header>

  <main class="cl-standalone">
    <section class="cl-hero-wrap">
      <div class="cl-grid" aria-hidden="true">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <defs>
            <pattern id="cl-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#000" stroke-width="0.5" stroke-opacity="0.12" />
            </pattern>
            <linearGradient id="cl-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f5f5f3" stop-opacity="0" />
              <stop offset="55%" stop-color="#f5f5f3" stop-opacity="0.55" />
              <stop offset="100%" stop-color="#f5f5f3" stop-opacity="1" />
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#cl-grid)" />
          <rect width="100%" height="28%" y="72%" fill="url(#cl-fade)" />
        </svg>
      </div>
      <div class="cl-hero">
        <h1>axi changelog</h1>
        <p>What's new in axi. Run <code class="chip">axi version</code> to see what you have installed. Full notes also in <a href="../../CHANGELOG.md">CHANGELOG.md</a>.</p>
      </div>
    </section>

    <div class="cl-content">
      <ol class="cl-timeline">
        <li class="cl-entry" id="cl-0-0-2">
          <div class="cl-meta">
            <span class="cl-badge">axi v0.0.2</span>
            <time datetime="2026-10">Oct 2026</time>
          </div>
          <div class="cl-body">
            <h2 class="cl-title">Mission, arl, daemon, judgment</h2>
            <p class="cl-prose">Keep-going mission product, continual harness (arl), background daemon, factory DAGs, and claim-quality gates.</p>
            <h3 class="cl-section"><span>New</span></h3>
            <ul class="cl-list">
              <li><span>Mission: Objective / Drive / Pulse / Choose · daemon keep-going without open chat</span></li>
              <li><span>arl: harness · digest · /refine · falsify · convergent · deploy · preship</span></li>
              <li><span>Evidence · reconcile · ledger · residual audit</span></li>
              <li><span>Daemon + agents roster · factory DAG · codemode · steer-interrupt</span></li>
              <li><span>Stance · investigate · belief · judgment · trajectory</span></li>
              <li><span>Config dry-run + approve</span></li>
            </ul>
            <p class="cl-prose"><a href="v0.0.2.md">Markdown notes →</a></p>
          </div>
        </li>
        <li class="cl-entry" id="cl-0-0-1">
          <div class="cl-meta">
            <span class="cl-badge">axi v0.0.1</span>
            <time datetime="2026-09">2026</time>
          </div>
          <div class="cl-body">
            <h2 class="cl-title">Initial public cut</h2>
            <p class="cl-prose">TTY chat, <code class="chip">axi ask</code>, providers, permissions, tools, spawn.</p>
          </div>
        </li>
      </ol>
    </div>
  </main>
</body>
</html>
`
write("changelog/index.html", clBody)

write(
  "changelog/v0.0.2.md",
  `# axi v0.0.2 — 2026-10

See root [CHANGELOG.md](../../CHANGELOG.md) for the full list.

Highlights:

- Mission product + daemon keep-going
- arl (auto RL) harness + gates
- Factory, daemon, agents view
- Judgment / evidence / reconcile / ledger / residual
- Steer-interrupt + config dry-run
`,
)

write(
  "README.md",
  `# Static axi docs (GitHub Pages)

Public product docs. Point GitHub Pages at the \`/docs\` folder on the default branch.

\`\`\`
docs/
  documentation/   # product docs (getting started, chat, CLI, mission, …)
  changelog/       # release notes (markdown + Pages HTML)
  assets/          # shared chrome (CSS, logo, favicon)
  index.html       # redirects → documentation/
\`\`\`

**Edit by regenerating:** \`node scripts/build-docs.mjs\` (or edit HTML under \`documentation/\` directly).

- Docs home: [\`documentation/\`](documentation/)
- Changelog: [\`changelog/\`](changelog/) — indexed from root [\`CHANGELOG.md\`](../CHANGELOG.md)

Root URL \`https://aquinf03.github.io/axi/\` redirects into \`documentation/\`.
`,
)

console.log("done")
