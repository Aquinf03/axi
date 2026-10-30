"use client"

import { useEffect } from "react"

const LOCAL = "/api/icon"
const REMOTE = "https://www.aquin.app/favicon.ico"

/**
 * Ensure the tab icon is the Aquin logo. Prefers `/api/icon` (local → remote);
 * if that request fails, point the link straight at aquin.app.
 */
export function Favicon() {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
    if (!link) {
      link = document.createElement("link")
      link.rel = "icon"
      document.head.appendChild(link)
    }

    const apply = (href: string) => {
      if (!link) return
      link.href = href
      link.type = href.endsWith(".png") ? "image/png" : "image/x-icon"
    }

    apply(LOCAL)

    const probe = new Image()
    probe.onerror = () => apply(REMOTE)
    probe.src = `${LOCAL}?t=${Date.now()}`

    return () => {
      probe.onload = null
      probe.onerror = null
    }
  }, [])

  return null
}
