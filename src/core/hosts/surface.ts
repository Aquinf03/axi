/**
 * Host environment injected into the app.
 * Core must not call pbcopy / open / xdg-open itself — go through this.
 */

export type HostEnv = {
  /** Absolute workspace / train root. */
  workspaceRoot: string
  /** Copy text to the system clipboard. Returns false if unavailable. */
  writeClipboard(text: string): Promise<boolean>
  /** Read text from the system clipboard. null if empty/unavailable. */
  readClipboard(): Promise<string | null>
  /** Open a URL (http/https/file/mailto) in the host's browser/handler. */
  openUrl(url: string): Promise<boolean>
}

export type MemoryHost = HostEnv & {
  /** Test inspection: last clipboard write. */
  clipboard: string
  /** Test inspection: URLs passed to openUrl. */
  opened: string[]
}

/** Memory host for tests — no OS side effects. */
export function createMemoryHost(workspaceRoot: string): MemoryHost {
  const host: MemoryHost = {
    workspaceRoot,
    clipboard: "",
    opened: [],
    async writeClipboard(text: string) {
      host.clipboard = text
      return true
    },
    async readClipboard() {
      return host.clipboard || null
    },
    async openUrl(url: string) {
      const href = normalizeOpenUrl(url)
      if (!href) return false
      host.opened.push(href)
      return true
    },
  }
  return host
}

const OPENABLE = new Set(["http:", "https:", "file:", "mailto:"])

/**
 * Normalize a user URL for opening.
 * Bare hosts like `example.com` or `localhost:3000` get `https://` added.
 * Returns null if empty or a disallowed scheme.
 */
export function normalizeOpenUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null

  // Explicit allowed schemes only (avoid treating host:port as a scheme).
  if (/^(https?|file|mailto):/i.test(t)) {
    try {
      const u = new URL(t)
      if (!OPENABLE.has(u.protocol)) return null
      return u.href
    } catch {
      return null
    }
  }

  // Disallowed schemes: javascript:, data:, … — not host:port
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[\w.-]+:\d+(?:\/|$)/i.test(t)) {
    return null
  }

  // Absolute filesystem path → file://
  if (t.startsWith("/") || /^[A-Za-z]:[\\/]/.test(t)) {
    try {
      return new URL(`file://${t}`).href
    } catch {
      return null
    }
  }

  // Bare host / path-ish: example.com, localhost:8080, www.foo.io/bar
  if (/^[\w.-]+(?::\d+)?(?:\/\S*)?$/i.test(t)) {
    try {
      return new URL(`https://${t}`).href
    } catch {
      return null
    }
  }

  return null
}

export function isOpenableUrl(raw: string): boolean {
  return normalizeOpenUrl(raw) != null
}
