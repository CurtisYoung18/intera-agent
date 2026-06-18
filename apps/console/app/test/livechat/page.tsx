'use client'

import Script from 'next/script'
import { useState } from 'react'

export default function LiveChatTestPage() {
  const [loaded, setLoaded] = useState(false)
  const configuredLicense = Number(process.env.NEXT_PUBLIC_LIVECHAT_TEST_LICENSE_ID)
  const hasTestLicense = Number.isFinite(configuredLicense) && configuredLicense > 0

  return (
    <>
      {hasTestLicense ? (
        <Script
          id="livechat-widget"
          strategy="afterInteractive"
          onLoad={() => setLoaded(true)}
        >{`
        window.__lc = window.__lc || {};
        window.__lc.license = ${configuredLicense};
        window.__lc.integration_name = "manual_channels";
        window.__lc.product_name = "livechat";
        ;(function(n,t,c){function i(n){return e._h?e._h.apply(null,n):e._q.push(n)}var e={_q:[],_h:null,_v:"2.0",on:function(){i(["on",c.call(arguments)])},once:function(){i(["once",c.call(arguments)])},off:function(){i(["off",c.call(arguments)])},get:function(){if(!e._h)throw new Error("[LiveChatWidget] You can't use getters before load.");return i(["get",c.call(arguments)])},call:function(){i(["call",c.call(arguments)])},init:function(){var n=t.createElement("script");n.async=!0,n.type="text/javascript",n.src="https://cdn.livechatinc.com/tracking.js",t.head.appendChild(n)}};!n.__lc.asyncInit&&e.init(),n.LiveChatWidget=n.LiveChatWidget||e}(window,document,[].slice))
      `}</Script>
      ) : null}
      <Script
        id="livechat-session-boundary"
        strategy="afterInteractive"
      >{`
        (function() {
          var storageKey = 'intera_livechat_chat_id';
          var lastStatus = null;

          function rememberChatId() {
            try {
              var chat = window.LiveChatWidget && window.LiveChatWidget.get && window.LiveChatWidget.get('chat_data');
              if (chat && chat.chatId) {
                window.sessionStorage.setItem(storageKey, chat.chatId);
              }
            } catch {}
          }

          function markFreshStart() {
            try {
              var chatId = window.sessionStorage.getItem(storageKey);
              if (!chatId) return;
              var payload = JSON.stringify({ chatId: chatId });
              if (navigator.sendBeacon) {
                navigator.sendBeacon('/api/livechat/widget-session-close', new Blob([payload], { type: 'application/json' }));
                return;
              }
              fetch('/api/livechat/widget-session-close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
              }).catch(function() {});
            } catch {}
          }

          function handleStatusChanged(data) {
            rememberChatId();
            var nextStatus = data && data.status ? data.status : null;
            var wasActive = lastStatus === 'chatting' || lastStatus === 'queued' || lastStatus === 'invited';
            if (wasActive && nextStatus === 'browsing') {
              markFreshStart();
            }
            lastStatus = nextStatus;
          }

          window.LiveChatWidget.on('ready', function(initialData) {
            rememberChatId();
            lastStatus = initialData && initialData.customerData ? initialData.customerData.status : lastStatus;
          });
          window.LiveChatWidget.on('new_event', rememberChatId);
          window.LiveChatWidget.on('customer_status_changed', handleStatusChanged);
          window.addEventListener('pagehide', markFreshStart);
          window.addEventListener('beforeunload', markFreshStart);
        })();
      `}</Script>

      <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a2e' }}>LiveChat Widget Test</h1>
        <p style={{ color: '#666', marginTop: 8, lineHeight: 1.6 }}>
          License <strong>{hasTestLicense ? configuredLicense : 'not configured'}</strong> · API Org<br />
          Webhook → <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 13 }}>
            /api/livechat/webhook/&lt;orgId&gt;/&lt;agentConfigId&gt;
          </code>
        </p>
        {!hasTestLicense ? (
          <div style={{ marginTop: 16, padding: 12, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, color: '#9a3412', fontSize: 13 }}>
            Set NEXT_PUBLIC_LIVECHAT_TEST_LICENSE_ID to enable this local test page.
          </div>
        ) : null}

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
          Widget status: {loaded ? <span style={{ color: '#22c55e' }}>Loaded</span> : <span style={{ color: '#f59e0b' }}>{hasTestLicense ? 'Loading…' : 'Disabled'}</span>}
        </p>
      </div>
    </>
  )
}
