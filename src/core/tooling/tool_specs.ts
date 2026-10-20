/** Tool JSON schemas / specs. Implementations live in src/tools + dispatch. */

export type AgentToolDef = {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

function nativeAqTools(): AgentToolDef[] {
  const verbs: [string, string][] = [
    ["init", "Create a run folder (aq-run or named): recipe.yaml + example.py + artifacts/. Paths live in the YAML."],
    ["help", "CLI help text."],
    ["status", "Last run, eval, metrics. If cwd is not a train, args MUST be the train folder."],
    ["train", "Fit locally. If cwd is not a train, args MUST be the train folder. Writes artifacts/checkpoints/last.json."],
    ["eval", "Score evals/ locally. If cwd is not a train, args starts with the train folder. Humans approve each step."],
    ["checkpoint", "List or keep a checkpoint. If cwd is not a train, pass the train folder in args."],
    ["serve", "Run last checkpoint locally: LLM completion, VLM (+ --image), vision classify, CLIP score, or tabular predict."],
    ["data", "Hash recipe data.path and write data/revision.json. args \"hash\" (or omit — hash is the default). Run this before aq_train when data must be hashed first."],
    ["diff", "Compare run records."],
    ["plot", "Generate charts from artifacts: metrics/jobs/runs (matplotlib) or samples/vision (torchvision image grid). Writes artifacts/plots/*.png."],
    [
      "fork",
      "Copy this train to a new folder. Sibling paths are ok. args: \"../name --lo N --hi N --why reason\". Skips jobs/ and artifacts/. Then edit that folder's recipe and aq_train it. Do not change this train's recipe.",
    ],
    ["spawn", "Worker agents: spawn agent / list / log / cancel."],
    ["provider", "List or set model providers."],
    ["update", "Install the latest aq release (same as curl install.sh | bash)."],
    ["version", "Print framework version."],
    ["places", "List SSH places / pools (live check). Read-only."],
    [
      "add",
      "Register compute. Prefer non-interactive: aq_add args \"ssh <name> --host H [--user U] [--port P] [--key PATH]\". Or pool: \"pool <name> m1 m2\".",
    ],
    ["launch", "Sync train folder to a place and install/refresh remote aq. Args e.g. \"--on <place>\" or train path + --on."],
    ["sync", "Re-sync train folder to the place session. Args: train and/or --on <place>."],
    ["go", "Open a shell on a place (interactive). Prefer jobs for non-interactive work."],
    ["shutdown", "Tear down a launch session on a place."],
    [
      "jobs",
      "Remote jobs on a place/pool: train|eval|serve|run|list|status|logs|wait|pull|down|recover|watch|sweep. After run/train/eval/serve, call wait <id> (polls status + log snapshots until done — never bare logs follow). Example: \"train --on lab\" then \"wait <id>\".",
    ],
    ["queue", "Local/remote job queues: add/push/worker/drain/move."],
    ["port", "SSH port forwards for a place/session."],
    ["tag", "Labels on places or jobs."],
  ]
  return verbs.map(([verb, description]) => ({
    name: `aq_${verb}`,
    description: `${description} Native aq ${verb}. Same as \`aq ${verb}\`.`,
    parameters: {
      type: "object" as const,
      properties: {
        args: { type: "string", description: `extra argv after '${verb}', space-separated` },
      },
    },
  }))
}

/** Always sent to the model — general coding core + discovery. */
export const CORE_TOOLS: AgentToolDef[] = [
  {
    name: "tools_search",
    description:
      "Search builtins, aq commands, tools/, and skills. Matching deferred tools (aq_*, spawn, plot, memory_*, arl_refine, codemode_*, factory_*, daemon_*, mission_done, decision_*) are loaded into this session so you can call them next. Discovering a tool does not approve it — sensitive calls still need a permit.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "keywords" } },
      required: ["query"],
    },
  },
  {
    name: "ls",
    description: "List a directory in the train. Default is .",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "relative dir, default ." } },
    },
  },
  {
    name: "find",
    description: "Find files and dirs in the train by name, substring, or glob (* and **).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "name, substring, or glob" },
        path: { type: "string", description: "relative root to search, default ." },
      },
      required: ["query"],
    },
  },
  {
    name: "glob",
    description: "Find paths by glob (*.ts, **/*.yaml). Names only, not file contents.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "glob pattern" },
        path: { type: "string", description: "relative root, default ." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description: "Search file contents in the train. Optional glob to limit files.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "text or regex" },
        path: { type: "string", description: "relative root, default ." },
        glob: { type: "string", description: "optional file glob like *.ts" },
      },
      required: ["query"],
    },
  },
  {
    name: "read",
    description:
      "Read a text file in the train. If path is a directory, lists it. For images (png/jpg/gif/webp) use view so the model can see them.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "relative path" } },
      required: ["path"],
    },
  },
  {
    name: "view",
    description:
      "View workspace assets for this turn: images (png/jpg/gif/webp) are attached multimodally; light text assets (svg, md, json, …) are inlined. Use when you need to see a screenshot, plot, or other file the user pointed at — not for Mission keep-going.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "one relative path (or omit if paths is set)",
        },
        paths: {
          type: "string",
          description: "optional JSON array of paths, e.g. [\"plots/a.png\",\"shot.png\"]",
        },
      },
    },
  },
  {
    name: "write",
    description: "Create or overwrite a file in the train. Makes parent dirs. Use for tools/, skills/, recipe, anything in this folder.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "relative path" },
        content: { type: "string", description: "full file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit",
    description: "Replace text in a file. old must be unique unless all is true.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "relative path" },
        old: { type: "string", description: "exact text to find" },
        new: { type: "string", description: "replacement" },
        all: { type: "boolean", description: "replace every match" },
      },
      required: ["path", "old", "new"],
    },
  },
  {
    name: "mkdir",
    description: "Create a directory in the train (and parents).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "relative dir" } },
      required: ["path"],
    },
  },
  {
    name: "mv",
    description: "Move or rename a file or folder inside the train.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "existing path" },
        to: { type: "string", description: "new path or destination dir" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "cp",
    description: "Copy a file inside the train.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "existing file" },
        to: { type: "string", description: "new path or destination dir" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "rm",
    description: "Delete a file or folder in the train. Not jobs/ or artifacts/.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "relative path" } },
      required: ["path"],
    },
  },
  {
    name: "run",
    description:
      "Run a shell command in the train. Human must approve. Set detach true for servers/watchers so they live in jobs/ and survive this prompt dying.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "the full command" },
        detach: {
          type: "boolean",
          description: "true for long-running: job in jobs/, log file, survives disconnect",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the public web. OpenAI, Anthropic, and Grok use their built-in search (same API key). Ollama uses a key-free fallback. Then web_fetch a URL if you need the page.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "search query" },
        count: { type: "number", description: "how many results, default 5, max 8" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch a public http(s) URL and return readable text. HTML is stripped. Use after web_search or when the user gives a link.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "http or https URL" } },
      required: ["url"],
    },
  },
  {
    name: "skill_load",
    description:
      "Activate skills/<name>. Loads markdown, starts MCP servers from mcp.json, and registers mcp_* tools for the rest of this session.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "skill_run",
    description: "Run the code in a skill (skills/<name>/run.py|ts|js|sh or skills/<name>.py|ts|js|sh).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "skill name" },
        args: { type: "string", description: "optional argv, space-separated" },
      },
      required: ["name"],
    },
  },
  {
    name: "tool",
    description:
      "Run a script in tools/ by its file stem (tools/broken.sh → name broken). If it exits non-zero, the error comes back and you continue with the next step the user asked for. Do not use shell run for these.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "stem in tools/, e.g. broken or count_rows" },
        args: { type: "string", description: "optional argv, space-separated" },
      },
      required: ["name"],
    },
  },
  {
    name: "skills_search",
    description: "Search skills/ by name or first line. Empty query lists them.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "keywords, or empty to list" } },
    },
  },
  {
    name: "stance_set",
    description:
      "Set judgment stance for this chat: explore (broaden), execute (ship), or challenge (adversarial). Peer to permission /mode and /codemode. Use when the trajectory warrants a posture change; switch to challenge when overconfident or stuck. Human-pinned stance cannot be overridden.",
    parameters: {
      type: "object",
      properties: {
        stance: {
          type: "string",
          description: "explore | execute | challenge",
        },
        reason: {
          type: "string",
          description: "short why (shown in /stance status)",
        },
      },
      required: ["stance"],
    },
  },
  {
    name: "investigate_add",
    description:
      "Add a node to this chat's investigation graph: hypothesis, evidence, contradiction, or branch. Richer than flat arl entries — link them with investigate_link.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "hypothesis | evidence | contradiction | branch",
        },
        title: { type: "string", description: "short label" },
        content: { type: "string", description: "detail / claim / observation" },
        id: { type: "string", description: "optional stable id" },
      },
      required: ["kind", "title", "content"],
    },
  },
  {
    name: "investigate_link",
    description:
      "Link two investigation nodes: supports, refutes, conflicts, abandons, or about.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "source node id" },
        to: { type: "string", description: "target node id" },
        kind: {
          type: "string",
          description: "supports | refutes | conflicts | abandons | about",
        },
        note: { type: "string", description: "optional edge note" },
      },
      required: ["from", "to", "kind"],
    },
  },
  {
    name: "investigate_abandon",
    description:
      "Mark a hypothesis/branch abandoned with why; mirrors into arl rejected (file-drawer) by default.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "node id" },
        why: { type: "string", description: "failure mode / reason not to retry" },
        mirror_rejected: {
          type: "boolean",
          description: "write arl rejected entry (default true)",
        },
      },
      required: ["id", "why"],
    },
  },
  {
    name: "judgment_tag",
    description:
      "Tag a pivot turn with the intervention taxonomy: hypothesis, tension, pivot, assumption, interpretation, or design. Use on refine/mission direction changes, conflicts, or unstated premises.",
    parameters: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description:
            "hypothesis | tension | pivot | assumption | interpretation | design",
        },
        note: { type: "string", description: "short why / what changed" },
      },
      required: ["label"],
    },
  },
  {
    name: "evidence_tag",
    description:
      "Tag a claim with an evidence grade: observed (tool saw it), derived (computed from observed), inferred (model/human conclusion), or unknown (not established — keep explicit). Prefer observed/derived before promoting lessons.",
    parameters: {
      type: "object",
      properties: {
        grade: {
          type: "string",
          description: "observed | derived | inferred | unknown",
        },
        text: { type: "string", description: "short claim" },
        ref: {
          type: "string",
          description: "optional backing pointer (tool name, investigate id, turn)",
        },
        note: { type: "string", description: "optional why" },
      },
      required: ["grade", "text"],
    },
  },
  {
    name: "claim_reconcile",
    description:
      "Reconcile a plan or code claim with what run / spawn / codemode saw: match, mismatch, or unknown (never checked). Surface conflicts explicitly — do not invent match from chat prose alone.",
    parameters: {
      type: "object",
      properties: {
        claim: { type: "string", description: "the plan or code claim" },
        verdict: {
          type: "string",
          description: "match | mismatch | unknown",
        },
        tool: {
          type: "string",
          description: "optional: run | spawn | spawn_log | codemode_run | …",
        },
        ref: { type: "string", description: "optional turn/job/path pointer" },
        observed: {
          type: "string",
          description: "short excerpt of what execution showed (not full stdout)",
        },
        note: { type: "string", description: "optional why" },
      },
      required: ["claim", "verdict"],
    },
  },
  {
    name: "obligation_add",
    description:
      "Add a required check to the mission obligation ledger (port/parity missions). /mission done is blocked while open checks remain.",
    parameters: {
      type: "object",
      properties: {
        check: { type: "string", description: "required check text" },
        owner: {
          type: "string",
          description: "optional unique owner among open checks",
        },
        verifier: {
          type: "string",
          description: "optional what would prove it",
        },
      },
      required: ["check"],
    },
  },
  {
    name: "obligation_owner",
    description: "Assign a unique owner to an open obligation (required before close).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "obligation id" },
        owner: { type: "string", description: "unique owner name" },
      },
      required: ["id", "owner"],
    },
  },
  {
    name: "obligation_close",
    description:
      "Close an obligation only when it has a unique owner and a claim_reconcile entry with verdict=match.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "obligation id" },
        reconcile_id: {
          type: "string",
          description: "claim_reconcile entry id with verdict match",
        },
      },
      required: ["id", "reconcile_id"],
    },
  },
  {
    name: "unknown_dispose",
    description:
      "Clear a residual unknown before /mission done or global /refine: resolve (regrade evidence or rematch reconcile), accept (keep unknown on purpose), or drop.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", description: "evidence | reconcile" },
        id: { type: "string", description: "evidence claim id or reconcile entry id" },
        action: { type: "string", description: "resolve | accept | drop" },
        grade: {
          type: "string",
          description: "for resolve+evidence: observed | derived | inferred",
        },
        verdict: {
          type: "string",
          description: "for resolve+reconcile: match | mismatch",
        },
        note: { type: "string", description: "optional why" },
      },
      required: ["kind", "id", "action"],
    },
  },
]

/**
 * Platform / rare tools — schemas omitted until tools_search loads them for the session.
 * Loading is discovery only; authorizeTool still gates sensitive calls.
 */
export const DEFERRED_TOOLS: AgentToolDef[] = [
  {
    name: "memory_search",
    description:
      "Search workspace memory (~/.axi/memory) and, when /arl on, arl harness memories. Hits tagged [workspace] or [arl].",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "keywords" } },
      required: ["query"],
    },
  },
  {
    name: "memory_read",
    description:
      "Read one memory by title from ~/.axi/memory, or arl harness memory when /arl on and workspace miss.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "note stem" } },
      required: ["name"],
    },
  },
  {
    name: "memory_write",
    description:
      "Save a durable workspace memory (~/.axi/memory). When /arl on, also mirrors into the global arl harness memory inventory.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "stem like run-notes" },
        body: { type: "string", description: "markdown body" },
      },
      required: ["name", "body"],
    },
  },
  {
    name: "arl_refine",
    description:
      "Schedule an arl continual-harness refine for when this turn ends (same path as /refine). Use after a repeated failure, reusable tactic, durable preference, or user correction worth persisting. Returns immediately — do not wait for apply. Requires /arl on.",
    parameters: {
      type: "object",
      properties: {
        instructions: {
          type: "string",
          description: "optional focus for the refine (what lesson to capture)",
        },
        global: {
          type: "boolean",
          description: "true = write global harness; default local to this chat",
        },
      },
    },
  },
  {
    name: "codemode_run",
    description:
      "Run JavaScript in the sticky Node codemode kernel for this chat (vars persist across cells). Prefer for multi-step code scratchpads; use `run` for one-shot shell. Sticky bindings: use var or globalThis.x (const/let are cell-local). Requires /codemode on (default on). Output is size-capped.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript cell to evaluate" },
        timeout_ms: {
          type: "number",
          description: "optional cell timeout in ms (default 30000, max 120000)",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "codemode_vars",
    description:
      "List sticky codemode bindings (name, type, short preview only — not a full dump). Requires /codemode on and a prior codemode_run.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "factory_run",
    description:
      "Start a factory DAG of spawned subagents (machine name like builder/review, a JSON path, or inline machine JSON). One run per chat; live dock updates in the TUI. Prefer for multi-agent fan-out/join workflows — not for single spawn.",
    parameters: {
      type: "object",
      properties: {
        machine: {
          type: "string",
          description: "machine name, path to .json, or inline machine JSON",
        },
      },
      required: ["machine"],
    },
  },
  {
    name: "factory_status",
    description: "Show the current factory run dock (node statuses).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "factory_stop",
    description: "Stop the active factory run (cancel running nodes) or clear a finished dock.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "factory_log",
    description: "Tail the agent log for one factory node id (same as /factory log).",
    parameters: {
      type: "object",
      properties: {
        node: { type: "string", description: "factory node id" },
        tail: { type: "number", description: "log lines (default 40)" },
      },
      required: ["node"],
    },
  },
  {
    name: "factory_cancel",
    description:
      "Cancel one running factory node after a prune receipt (arl rejected). Requires why. Same as /factory cancel <node> <why>.",
    parameters: {
      type: "object",
      properties: {
        node: { type: "string", description: "factory node id" },
        why: {
          type: "string",
          description: "failure mode / why this node is being killed (required)",
        },
      },
      required: ["node", "why"],
    },
  },
  {
    name: "daemon_status",
    description:
      "Show whether the axi background daemon is up (ticks mission/factory; preferred spawn host). Same as /daemon status.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "mission_done",
    description:
      "Mark the active mission objective complete (same as /mission done). Only call when the user asked for a mission and the objective is actually finished — not for drive/pulse alone.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "optional one-line what was accomplished",
        },
      },
    },
  },
  {
    name: "decision_decide",
    description:
      "System 1 choose-from-options: pick exactly one action from a fixed menu given an observation (and optional goal). Uses the active chat model. Prefer this for research next-step forks — not for Mission keep-going.",
    parameters: {
      type: "object",
      properties: {
        observation: {
          type: "string",
          description: "current situation / state to decide from (JSON string ok)",
        },
        actions: {
          type: "string",
          description: 'JSON object map of action name → when it applies, e.g. {"left":"go left","right":"go right"}',
        },
        goal: { type: "string", description: "optional goal / strategy" },
        instructions: { type: "string", description: "optional decision instructions" },
        images: {
          type: "string",
          description:
            'optional JSON array of image paths or data URLs for vision decide, e.g. ["shot.png"]',
        },
      },
      required: ["observation", "actions"],
    },
  },
  {
    name: "decision_loop_start",
    description:
      "Start a host Decision Loop: shell observe → decide → shell act on a timer. System 2 only updates the goal afterward. actCmd may include {action}; AXI_DECISION_ACTION is set.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        observe_cmd: { type: "string", description: "shell; stdout = observation; empty stdout ends loop" },
        act_cmd: { type: "string", description: "shell; {action} replaced" },
        actions: {
          type: "string",
          description: 'JSON object map of action name → when it applies',
        },
        goal: { type: "string" },
        tick_ms: { type: "number" },
        max_steps: { type: "number" },
        on_error: { type: "string", description: "stop | skip" },
      },
      required: ["objective", "observe_cmd", "act_cmd", "actions"],
    },
  },
  {
    name: "decision_loop_set_goal",
    description: "Update the live Decision Loop goal (System 2). Next tick sees it.",
    parameters: {
      type: "object",
      properties: { goal: { type: "string" } },
      required: ["goal"],
    },
  },
  {
    name: "decision_loop_status",
    description: "Show Decision Loop status / last step.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "decision_loop_stop",
    description: "Stop the Decision Loop and clear its timer.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "aq",
    description:
      "Run any aq CLI verb in this train. Prefer the native aq_* tools when you know the verb. args is space-separated, no pipes.",
    parameters: {
      type: "object",
      properties: { args: { type: "string", description: "e.g. status  or  eval smoke" } },
      required: ["args"],
    },
  },
  ...nativeAqTools(),
  {
    name: "spawn",
    description:
      "Start a worker axi on this train (same as `axi spawn agent`). Optional spec = arl harness subagent id (/arl on). prompt is the task (or full prompt when no spec). kill true = cheapest-disproof critic.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "task for the worker; with spec, appended as Task; without spec, full prompt (required if no spec)",
        },
        spec: {
          type: "string",
          description: "arl harness subagent id or title (requires /arl on)",
        },
        name: { type: "string", description: "optional short name" },
        kill: { type: "boolean", description: "true: critic whose job is cheapest disproof" },
      },
    },
  },
  {
    name: "spawn_list",
    description:
      "List worker agents and evidence counts. Parent cost rollup when handoffs report usage. Last sentence ≠ proof.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "spawn_log",
    description:
      "Show a worker handoff (artifact/receipt IDs + usage) and log. Prose in the log is not proof — cite handoff artifacts.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "agent id" } },
      required: ["id"],
    },
  },
  {
    name: "spawn_cancel",
    description:
      "Stop a worker agent after recording a prune receipt (arl rejected). Requires why — the failure mode.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "agent id" },
        why: {
          type: "string",
          description: "failure mode / why this fork is being killed (required)",
        },
      },
      required: ["id", "why"],
    },
  },
  {
    name: "plot",
    description:
      "Generate charts. kind=metrics|jobs|runs|samples|all. Pass control via aq plot flags in args when using aq_plot, or kind here. metrics: --fields/--style/--title; samples: --max/--nrow/--from/--backend. Writes artifacts/plots/.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "metrics | jobs | runs | samples | vision | all (default all)",
        },
        args: {
          type: "string",
          description: "extra aq plot flags, e.g. \"--fields loss --style line --title loss\"",
        },
      },
    },
  },
]

/** Full catalog (core + deferred). Not what is sent every turn — see toolsForTrain. */
export const AGENT_TOOLS: AgentToolDef[] = [...CORE_TOOLS, ...DEFERRED_TOOLS]

const DEFERRED_BY_NAME = new Map(DEFERRED_TOOLS.map((t) => [t.name, t]))

export function isDeferredTool(name: string): boolean {
  return DEFERRED_BY_NAME.has(name)
}

export function deferredToolDef(name: string): AgentToolDef | undefined {
  return DEFERRED_BY_NAME.get(name)
}
