import type { Metadata } from "next"
import { Host_Grotesk, IBM_Plex_Mono } from "next/font/google"
import { Favicon } from "@/components/favicon"
import "./globals.css"

const hostGrotesk = Host_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
})

export const metadata: Metadata = {
  title: "axi",
  description: "axi — coding / research agent (web)",
  icons: {
    // Local brand first (`/api/icon` → aquin-icon / mainlogo); aquin.app as last resort.
    icon: [
      { url: "/api/icon", type: "image/png" },
      { url: "/aquin-icon.png", type: "image/png" },
      { url: "https://www.aquin.app/favicon.ico" },
    ],
    shortcut: "/api/icon",
    apple: "/aquin-icon.png",
  },
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${hostGrotesk.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground font-sans min-h-full flex flex-col">
        <Favicon />
        {children}
      </body>
    </html>
  )
}
