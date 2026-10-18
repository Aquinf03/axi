/** Agents roster — board text + daemon line (CLI / note dump). */

import { formatAgentsBoard } from "./view.js"

export function formatAgentsRoster(workspace: string, parentId?: string): string {
  return formatAgentsBoard({ workspace, parentId })
}

export { formatAgentsBoard, agentsMenuRows, statusGlyph } from "./view.js"
