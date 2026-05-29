// apps/chat/app/livechat-widget/layout.tsx
// Opt out of the root layout — In-Chat App must be a bare HTML page.
//
// Canonical LiveChat Moments SDK integration (BUG-F auto-close):
// define window.onMomentAsyncInit BEFORE loading the SDK script, so when this
// page runs inside a LiveChat Moment/webview the host invokes the callback and
// we capture the SDK instance promise on window.__interaMomentsSDK. The widget
// page awaits that to call sdk.close() after a form submit. Opened standalone
// (no Moment host) → callback never fires → page falls back to the "submitted"
// screen (no auto-close), the intended graceful degradation.
const MOMENTS_INIT = `
  window.onMomentAsyncInit = function (createMomentsSDK) {
    try { window.__interaMomentsSDK = createMomentsSDK({ title: 'Intera' }); }
    catch (e) { window.__interaMomentsSDK = Promise.resolve(null); }
  };
`

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: MOMENTS_INIT }} />
        <script
          src="https://cdn.livechat-static.com/moments-sdk/moments-sdk-1.9.0.umd.min.js"
          async
        />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#f9fafb' }}>
        {children}
      </body>
    </html>
  )
}
