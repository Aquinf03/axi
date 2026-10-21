/**
 * Aquin account login — same handoff as `aq login`:
 * open aquin.app/axi/?view=desktop → paste aquin://auth?code=… → exchange → ~/.aquin/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const CONFIG_PATH = path.join(homedir(), ".aquin", "config.json")
const DEFAULT_AUTH_URL = "https://aquin.app"

export type AquinAccount = {
  api_key: string
  email?: string | null
  name?: string | null
  user_id?: string | null
  avatar_url?: string | null
  saved_at?: string
  verified_at?: number
}

type AuthCfg = {
  accounts: Record<string, AquinAccount>
  active_account: string
}

export function aquinConfigPath(): string {
  return CONFIG_PATH
}

/** Auth host. Prod: https://aquin.app. Local: AQUIN_AUTH_URL=http://localhost:3000 */
export function aquinAuthBase(): string {
  return (process.env.AQUIN_AUTH_URL || DEFAULT_AUTH_URL).replace(/\/$/, "")
}

/** Desktop handoff URL opened in the browser. */
export function aquinLoginUrl(): string {
  return `${aquinAuthBase()}/axi/?view=desktop&client=axi`
}

export function normalizeAquinToken(raw: string): string {
  let key = String(raw || "").trim()
  if (key.toLowerCase().startsWith("bearer ")) key = key.slice(7).trim()
  return key
}

function isUserUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  )
}

function accountId(
  email: string | null | undefined,
  name: string | null | undefined,
  userId: string | null | undefined,
): string {
  if (email && String(email).includes("@")) return String(email).trim().toLowerCase()
  if (userId) return String(userId)
  if (name) return String(name).trim().toLowerCase().replace(/\s+/g, "-")
  return "account"
}

function loadCfg(): AuthCfg {
  if (!existsSync(CONFIG_PATH)) return { accounts: {}, active_account: "" }
  try {
    const data = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>
    if (!data || typeof data !== "object") return { accounts: {}, active_account: "" }
    const accounts = data.accounts
    if (accounts && typeof accounts === "object" && Object.keys(accounts as object).length) {
      return {
        accounts: accounts as Record<string, AquinAccount>,
        active_account: String(data.active_account || ""),
      }
    }
    const key = normalizeAquinToken(String(data.api_key || ""))
    const accountsDict: Record<string, AquinAccount> = {}
    let active = ""
    if (key) {
      const label = String(data.active_account || "saved").trim() || "saved"
      accountsDict[label] = {
        api_key: key,
        name: (data.account_name as string) ?? null,
        email:
          data.account_email && String(data.account_email).includes("@")
            ? String(data.account_email)
            : null,
      }
      active = label
    }
    return { accounts: accountsDict, active_account: active }
  } catch {
    return { accounts: {}, active_account: "" }
  }
}

function saveCfg(cfg: AuthCfg): void {
  mkdirSync(path.join(homedir(), ".aquin"), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8")
}

export function activeAquinAccount(): { id: string; meta: AquinAccount } | null {
  const cfg = loadCfg()
  let id = String(cfg.active_account || "").trim()
  if (id && !cfg.accounts[id]) id = ""
  if (!id) {
    const keys = Object.keys(cfg.accounts)
    if (keys.length) id = keys[0]!
  }
  const meta = id ? cfg.accounts[id] : null
  if (!meta || !normalizeAquinToken(meta.api_key || "")) return null
  return { id, meta }
}

export function hasAquinLogin(): boolean {
  return activeAquinAccount() != null
}

/** Display name for greetings — prefers profile name, then email local-part. */
export function aquinDisplayName(): string {
  const cur = activeAquinAccount()
  if (!cur) return ""
  const name = String(cur.meta.name || "").trim()
  if (name) return name.split(/\s+/)[0] || name
  const email = String(cur.meta.email || "").trim()
  if (email.includes("@")) return email.split("@")[0] || email
  return cur.id
}

export function saveAquinLogin(payload: {
  api_key: string
  email?: string | null
  name?: string | null
  user_id?: string | null
  avatar_url?: string | null
}): string {
  const key = normalizeAquinToken(payload.api_key)
  if (!key.startsWith("aq-") || key.length < 20) {
    throw new Error("Invalid account token from aquin.app.")
  }
  const aid = accountId(payload.email, payload.name, payload.user_id)
  const cfg = loadCfg()
  const prev: AquinAccount =
    cfg.accounts[aid] && typeof cfg.accounts[aid] === "object"
      ? cfg.accounts[aid]!
      : { api_key: "" }
  const avatarUrl = String(payload.avatar_url || prev.avatar_url || "").trim()
  cfg.accounts[aid] = {
    ...prev,
    api_key: key,
    email: payload.email || prev.email || null,
    name: payload.name || prev.name || null,
    user_id: isUserUuid(payload.user_id)
      ? String(payload.user_id).trim()
      : isUserUuid(prev.user_id)
        ? String(prev.user_id).trim()
        : null,
    ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    saved_at: new Date().toISOString(),
    verified_at: Date.now() / 1000,
  }
  cfg.active_account = aid
  saveCfg(cfg)
  return aid
}

/** Parse pasted aquin://auth?code=… handoff or a bare one-time code. */
export function parseAquinHandoff(raw: string): string | null {
  let s = String(raw || "").trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  if (!s) return null
  if (!s.includes("://") && /^[A-Za-z0-9_-]{24,}$/.test(s)) return s
  const embedded = s.match(/aquin:\/\/[^\s"']+/i)
  if (embedded) s = embedded[0]!
  else if (!s.toLowerCase().startsWith("aquin:")) return null
  try {
    const u = new URL(s)
    const host = (u.hostname || u.host || "").toLowerCase()
    const pathName = (u.pathname || "").replace(/^\//, "").toLowerCase()
    if (
      host !== "auth" &&
      pathName !== "auth" &&
      host !== "open" &&
      pathName !== "open" &&
      host !== ""
    ) {
      return null
    }
    return u.searchParams.get("code")
  } catch {
    return null
  }
}

export async function exchangeAquinCode(code: string): Promise<{
  api_key: string
  email?: string | null
  name?: string | null
  user_id?: string | null
  avatar_url?: string | null
}> {
  const url = `${aquinAuthBase()}/api/auth/desktop/exchange`
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code }),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `sign-in failed (HTTP ${res.status})`)
  }
  const api_key = normalizeAquinToken(String(data.api_key || ""))
  if (!api_key.startsWith("aq-") || api_key.length < 20) {
    throw new Error("server returned an invalid account token")
  }
  return {
    api_key,
    email: (data.email as string) ?? null,
    name: (data.name as string) ?? null,
    user_id: (data.user_id as string) ?? null,
    avatar_url: (data.avatar_url as string) ?? null,
  }
}

/** Exchange handoff paste and persist to ~/.aquin/config.json. */
export async function completeAquinLogin(pasted: string): Promise<{ id: string; label: string }> {
  const code = parseAquinHandoff(pasted)
  if (!code) throw new Error("need aquin://auth?code=… or a one-time code")
  const payload = await exchangeAquinCode(code)
  const id = saveAquinLogin(payload)
  const meta = activeAquinAccount()?.meta
  const name = String(meta?.name || "").trim()
  const email = String(meta?.email || "").trim()
  const label = name && email ? `${name} (${email})` : email || name || id
  return { id, label }
}
