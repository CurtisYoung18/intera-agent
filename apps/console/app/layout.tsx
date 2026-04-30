import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Intera Console — Harness',
  description: 'Operator console for human tasks & agent configuration',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-void">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&family=Noto+Sans+SC:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-[100dvh] bg-void text-mist font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
