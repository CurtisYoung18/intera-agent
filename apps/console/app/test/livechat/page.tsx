'use client'

import Script from 'next/script'
import { useState } from 'react'

export default function LiveChatTestPage() {
  const [loaded, setLoaded] = useState(false)

  return (
    <>
      <Script
        id="livechat-widget"
        strategy="afterInteractive"
        onLoad={() => setLoaded(true)}
      >{`
        window.__lc = window.__lc || {};
        window.__lc.license = 18578946;
        window.__lc.integration_name = "manual_channels";
        window.__lc.product_name = "livechat";
        ;(function(n,t,c){function i(n){return e._h?e._h.apply(null,n):e._q.push(n)}var e={_q:[],_h:null,_v:"2.0",on:function(){i(["on",c.call(arguments)])},once:function(){i(["once",c.call(arguments)])},off:function(){i(["off",c.call(arguments)])},get:function(){if(!e._h)throw new Error("[LiveChatWidget] You can't use getters before load.");return i(["get",c.call(arguments)])},call:function(){i(["call",c.call(arguments)])},init:function(){var n=t.createElement("script");n.async=!0,n.type="text/javascript",n.src="https://cdn.livechatinc.com/tracking.js",t.head.appendChild(n)}};!n.__lc.asyncInit&&e.init(),n.LiveChatWidget=n.LiveChatWidget||e}(window,document,[].slice))
      `}</Script>

      <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a2e' }}>LiveChat Widget Test</h1>
        <p style={{ color: '#666', marginTop: 8, lineHeight: 1.6 }}>
          License <strong>18578946</strong> · API Vendor<br />
          Webhook → <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 13 }}>
            intera-chat.up.railway.app/api/livechat/webhook/api
          </code>
        </p>

        <div style={{ marginTop: 24, padding: 16, background: '#f8f9fa', borderRadius: 12, border: '1px solid #e9ecef' }}>
          <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>How to test</p>
          <ol style={{ fontSize: 13, color: '#555', marginTop: 8, paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>Click the chat bubble ↓ in the bottom-right corner</li>
            <li style={{ marginBottom: 6 }}>Type a message (e.g. &quot;Hello, I need help with a deposit&quot;)</li>
            <li style={{ marginBottom: 6 }}>Intera Agent will respond automatically</li>
            <li>Check <a href="/ops/chats" style={{ color: '#6366f1' }}>Chats</a> to see the conversation trace</li>
          </ol>
        </div>

        <p style={{ marginTop: 24, fontSize: 12, color: '#999' }}>
          Widget status: {loaded ? <span style={{ color: '#22c55e' }}>Loaded</span> : <span style={{ color: '#f59e0b' }}>Loading…</span>}
        </p>
      </div>
    </>
  )
}
