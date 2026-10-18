/**
 * Alternate screen for exclusive UI owners only.
 * Main chat and slash menus stay in normal scrollback.
 *
 * Owners: permission picker · confirm pickers
 */

/** Enter alternate screen buffer and hide cursor. */
export const ALT_ENTER = "\x1b[?1049h\x1b[H\x1b[2J\x1b[?25l"

/** Leave alternate screen and show cursor. */
export const ALT_LEAVE = "\x1b[?1049l\x1b[?25h"

export type AltOwner = "permit" | "compact"

export type AltScreen = {
  /** Current exclusive owner, or null when on the main scrollback. */
  readonly owner: AltOwner | null
  enter(owner: AltOwner): void
  leave(): void
  active(): boolean
}

export function createAltScreen(write: (s: string) => void): AltScreen {
  let owner: AltOwner | null = null
  return {
    get owner() {
      return owner
    },
    enter(next: AltOwner) {
      if (owner === next) {
        write("\x1b[H\x1b[2J")
        return
      }
      if (!owner) write(ALT_ENTER)
      else write("\x1b[H\x1b[2J")
      owner = next
    },
    leave() {
      if (!owner) return
      write(ALT_LEAVE)
      owner = null
    },
    active() {
      return owner != null
    },
  }
}
