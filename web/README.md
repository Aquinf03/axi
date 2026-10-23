# axi web

Next.js (App Router) + TypeScript + Tailwind v4 + shadcn UI front end for axi.

Browser front end for the **local** axi agent.

**Layout:** left = agentic chat (multi-tab) · right = VS Code–style viewer (file tree · Monaco editor · terminal). After a chat turn, the viewer refreshes files the agent touched.

## Start (preferred)

From any project folder (axi on `PATH`, built package / checkout with `web/`):

```bash
axi web
```

Opens [http://127.0.0.1:3000](http://127.0.0.1:3000). Installs `web/` deps if needed, builds axi `dist/` if missing, starts Next, opens the browser. Workspace = cwd (or pass a dir: `axi web /path/to/project`).

| Flag | Effect |
| --- | --- |
| `--port N` | Listen port (default `3000`) |
| `--detach` | Background Next · print URL · exit |
| `--no-open` | Start without opening a browser |

In TTY chat: `/web` does the same launch (detached) and opens the browser.

See product docs: [Web UI](https://aquinf03.github.io/axi/documentation/web/).

## Develop (checkout)

```bash
# from axi repo root
npm run build
npm run web
# or: AXI_WEB_WORKSPACE=/path/to/project npm run web
```

## API

| Route | Role |
| --- | --- |
| `GET /api/status` | local bridge ready? |
| `POST /api/chat` | `{ history, workspace? }` → NDJSON progress + `done` (`runTurn`) |
| `GET /api/fs/tree` | workspace file tree |
| `GET/PUT /api/fs/file` | read / save file |
| `POST /api/fs/workspace` | validate / switch workspace directory |
| `POST /api/term` | run shell command in workspace |

Web turns use **full-access**. Bridge: `scripts/web-turn.mjs`.

## Stack

| Piece | Notes |
| --- | --- |
| Next.js 16 | App Router |
| shadcn | UI primitives |
| Monaco | code editor |
| xterm | terminal panel |
| react-markdown | chat replies |
