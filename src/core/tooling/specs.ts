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

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: "memory_search",
    description: "Search memory for this train (~/.axi/memory, keyed like chats).",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "keywords" } },
      required: ["query"],
    },
  },
  {
    name: "memory_read",
    description: "Read one memory entry by title (~/.axi/memory for this train).",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "note stem" } },
      required: ["name"],
    },
  },
  {
    name: "memory_write",
    description: "Save a durable memory entry for this train (~/.axi/memory). Like pinning a chat note — not a file in the experiment folder.",
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
    name: "tools_search",
    description: "Search builtins, tools/, aq commands, and skills.",
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
    description: "Read a file in the train. If path is a directory, lists it.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "relative path" } },
      required: ["path"],
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
      "Start a worker axi on this train (same as `axi spawn agent`). Runs in the background as a job (artifacts/agents/<id>/). Use spawn_list and spawn_log to follow. kill true = cheapest-disproof critic, not a cheerleader.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "what the worker should do" },
        name: { type: "string", description: "optional short name" },
        kill: { type: "boolean", description: "true: critic whose job is cheapest disproof" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "spawn_list",
    description: "List worker agents on this train.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "spawn_log",
    description: "Show a worker agent's log and status.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "agent id" } },
      required: ["id"],
    },
  },
  {
    name: "spawn_cancel",
    description: "Stop a worker agent.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "agent id" } },
      required: ["id"],
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
  {
    name: "skills_search",
    description: "Search skills/ by name or first line. Empty query lists them.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "keywords, or empty to list" } },
    },
  },
]
