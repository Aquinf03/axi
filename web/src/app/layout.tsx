import type { Metadata } from "next"
import { Host_Grotesk, IBM_Plex_Mono } from "next/font/google"
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
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${hostGrotesk.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground font-sans min-h-full flex flex-col">
        {children}
      </body>
    </html>
  )
}
