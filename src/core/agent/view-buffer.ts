/** Side channel: images attached by the `view` tool for the next tool-result message. */

import type { ChatImage } from "./image.js"

const pending = new Map<string, ChatImage[]>()

/** Session key — use workspace path or "_" when unknown. */
export function queueViewImages(sessionKey: string, images: ChatImage[]): void {
  if (!images.length) return
  const cur = pending.get(sessionKey) ?? []
  cur.push(...images)
  pending.set(sessionKey, cur)
}

export function takeViewImages(sessionKey: string): ChatImage[] {
  const imgs = pending.get(sessionKey) ?? []
  pending.delete(sessionKey)
  return imgs
}

export function clearViewImages(sessionKey?: string): void {
  if (sessionKey) pending.delete(sessionKey)
  else pending.clear()
}
