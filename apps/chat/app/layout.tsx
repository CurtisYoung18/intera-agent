import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Intera — Agentic Customer Service',
  description: 'AI-powered case resolution',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&family=Noto+Sans+SC:wght@400;500&family=Noto+Serif+SC:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-[100dvh] text-mist font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
