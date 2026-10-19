/** Stance modes — judgment posture (peer to permission /mode and codemode). */

export const STANCE_MODES = ["explore", "execute", "challenge"] as const
export type StanceMode = (typeof STANCE_MODES)[number]

export const STANCE_FILE = "stance.json"
export const DEFAULT_STANCE: StanceMode = "execute"

export type StanceState = {
  stance: StanceMode
  /** Human-pinned via /stance — agent cannot override until unpinned. */
  pinned: boolean
  updated_at: string
  /** Who last set it. */
  source: "default" | "human" | "agent" | "hard-route"
  reason?: string
}
