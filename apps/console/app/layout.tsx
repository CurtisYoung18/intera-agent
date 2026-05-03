import type { Metadata } from 'next'
import './globals.css'
import ConsoleShell from '@/components/console-shell'

export const metadata: Metadata = {
  title: 'Intera Console',
  description: 'Operator console & agent configuration',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&family=Noto+Sans+SC:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-[100dvh] antialiased">
        <ConsoleShell>{children}</ConsoleShell>
      </body>
    </html>
  )
}
