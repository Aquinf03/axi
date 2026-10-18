/**
 * Treat paths / tool args / JSON text as data (Zig `[]const u8` mindset).
 * No silent trimming of meaningful content; strip only NULs and C0 controls
 * when writing into terminals / notifications.
 */

/** Drop NUL and other C0 controls except tab/newline/carriage-return. */
export function stripControls(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 9 || c === 10 || c === 13) {
      out += s[i]!
      continue
    }
    if (c < 32 || c === 127) continue
    out += s[i]!
  }
  return out
}

/** UTF-8 byte length (not JS string length). */
export function byteLen(s: string): number {
  return Buffer.byteLength(s, "utf8")
}

/** Clip by UTF-8 bytes, not code units. */
export function clipBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return ""
  if (byteLen(s) <= maxBytes) return s
  let end = s.length
  while (end > 0 && byteLen(s.slice(0, end)) > maxBytes) end--
  return s.slice(0, end)
}

/** True if the string contains a NUL (unsafe for many C / shell bridges). */
export function hasNul(s: string): boolean {
  return s.includes("\0")
}

/** Reject paths/args that embed NUL. */
export function assertNoNul(s: string, label = "value"): string {
  if (hasNul(s)) throw new Error(`${label} contains NUL`)
  return s
}
