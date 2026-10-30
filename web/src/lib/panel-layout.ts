/** Persist resizable-panel layouts across reloads. */

export type PanelLayout = Record<string, number>

export function readPanelLayout(key: string): PanelLayout | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const j = JSON.parse(raw) as unknown
    if (!j || typeof j !== "object" || Array.isArray(j)) return undefined
    const out: PanelLayout = {}
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v
    }
    return Object.keys(out).length ? out : undefined
  } catch {
    return undefined
  }
}

export function writePanelLayout(key: string, layout: PanelLayout) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(key, JSON.stringify(layout))
  } catch {
    /* quota / private mode */
  }
}

export const CHAT_LAYOUT_KEY = "axi.web.layout.chat"
export const IDE_LAYOUT_KEY = "axi.web.layout.ide"
