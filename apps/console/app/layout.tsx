import type { Metadata } from 'next'
import './globals.css'
import ConsoleShell from '@/components/console-shell'
import { LocaleProvider } from '@/components/locale-provider'

export const metadata: Metadata = {
  title: 'Intera Console',
  description: 'Operator console & agent configuration',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&family=Noto+Sans+SC:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-32.png" sizes="32x32" />
        <link rel="icon" href="/favicon-16.png" sizes="16x16" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="min-h-[100dvh] antialiased">
        <LocaleProvider>
          <ConsoleShell>{children}</ConsoleShell>
        </LocaleProvider>
      </body>
    </html>
  )
}
