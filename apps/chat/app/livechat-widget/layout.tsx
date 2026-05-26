// apps/chat/app/livechat-widget/layout.tsx
// Opt out of the root layout — In-Chat App must be a bare HTML page.
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#f9fafb' }}>
        {children}
      </body>
    </html>
  )
}
