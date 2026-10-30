"use client"

import { useState } from "react"
import Image from "next/image"

const LOCAL = "/mainlogo2.png"
const REMOTE = "https://www.aquin.app/favicon.ico"

type Props = {
  width: number
  height: number
  className?: string
  priority?: boolean
  alt?: string
}

/** Aquin mark — local logo first, aquin.app favicon if that fails. */
export function AquinLogo({ width, height, className, priority, alt = "" }: Props) {
  const [src, setSrc] = useState(LOCAL)
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
      unoptimized={src === REMOTE}
      onError={() => {
        if (src !== REMOTE) setSrc(REMOTE)
      }}
    />
  )
}
