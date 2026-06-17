export type MomentsSdkClient = {
  close?: () => Promise<void> | void
}

type CreateMomentsSDK = (options?: {
  title?: string
  icon?: string
  isFragile?: boolean
}) => Promise<MomentsSdkClient>

declare global {
  interface Window {
    MomentsSDK?: MomentsSdkClient | CreateMomentsSDK | { default?: CreateMomentsSDK; createMomentsSDK?: CreateMomentsSDK }
    onMomentAsyncInit?: (createMomentsSDK: CreateMomentsSDK) => void
    __interaMomentsSdkPromise?: Promise<MomentsSdkClient | null>
  }
}

const MOMENTS_SDK_SRC = 'https://cdn.livechat-static.com/moments-sdk/moments-sdk-1.9.0.umd.min.js'

function readExistingMomentsClient(): MomentsSdkClient | null {
  if (typeof window === 'undefined') return null
  const candidate = window.MomentsSDK
  if (!candidate || typeof candidate !== 'object') return null

  const close = (candidate as { close?: unknown }).close
  if (typeof close === 'function') {
    return candidate as MomentsSdkClient
  }
  return null
}

function readCreateMomentsSDK(): CreateMomentsSDK | null {
  if (typeof window === 'undefined') return null
  const candidate = window.MomentsSDK
  if (typeof candidate === 'function') return candidate
  if (!candidate || typeof candidate !== 'object') return null

  const createMomentsSDK = (candidate as { createMomentsSDK?: unknown }).createMomentsSDK
  if (typeof createMomentsSDK === 'function') return createMomentsSDK as CreateMomentsSDK

  const defaultExport = (candidate as { default?: unknown }).default
  if (typeof defaultExport === 'function') return defaultExport as CreateMomentsSDK
  return null
}

export function ensureMomentsSdk(options?: {
  title?: string
  icon?: string
  isFragile?: boolean
}): Promise<MomentsSdkClient | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.__interaMomentsSdkPromise) return window.__interaMomentsSdkPromise

  const existingClient = readExistingMomentsClient()
  if (existingClient) {
    window.__interaMomentsSdkPromise = Promise.resolve(existingClient)
    return window.__interaMomentsSdkPromise
  }

  const createImmediately = readCreateMomentsSDK()
  if (createImmediately) {
    window.__interaMomentsSdkPromise = Promise.resolve(createImmediately(options)).catch(() => null)
    return window.__interaMomentsSdkPromise
  }

  window.__interaMomentsSdkPromise = new Promise<MomentsSdkClient | null>((resolve) => {
    const previousHook = window.onMomentAsyncInit
    let settled = false

    const finish = (sdk: MomentsSdkClient | null) => {
      if (settled) return
      settled = true
      window.onMomentAsyncInit = previousHook
      resolve(sdk)
    }

    const initialize = (createMomentsSDK: CreateMomentsSDK) => {
      Promise.resolve(createMomentsSDK(options))
        .then((sdk) => finish(sdk))
        .catch(() => finish(null))
    }

    window.onMomentAsyncInit = (createMomentsSDK) => {
      previousHook?.(createMomentsSDK)
      initialize(createMomentsSDK)
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-intera-moments-sdk="true"]')
    if (existingScript) {
      const existingClientAfterScript = readExistingMomentsClient()
      if (existingClientAfterScript) {
        finish(existingClientAfterScript)
      } else {
        const fallback = readCreateMomentsSDK()
        if (fallback) initialize(fallback)
        else existingScript.addEventListener('load', () => {
          const loadedClient = readExistingMomentsClient()
          if (loadedClient) finish(loadedClient)
          else {
            const loaded = readCreateMomentsSDK()
            if (loaded) initialize(loaded)
            else finish(null)
          }
        }, { once: true })
      }
      existingScript.addEventListener('error', () => finish(null), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = MOMENTS_SDK_SRC
    script.async = true
    script.dataset.interaMomentsSdk = 'true'
    script.addEventListener('load', () => {
      const loadedClient = readExistingMomentsClient()
      if (loadedClient) finish(loadedClient)
      else {
        const loaded = readCreateMomentsSDK()
        if (loaded) initialize(loaded)
        else finish(null)
      }
    }, { once: true })
    script.addEventListener('error', () => finish(null), { once: true })
    document.body.appendChild(script)
  })

  return window.__interaMomentsSdkPromise
}

function fallbackReturnToChat(): boolean {
  if (typeof window === 'undefined') return false

  try {
    window.parent?.postMessage({ type: 'intera:livechat:return-to-chat' }, '*')
  } catch {}

  if (window.history.length > 1) {
    window.history.back()
    return true
  }

  try {
    window.close()
    return true
  } catch {
    return false
  }
}

export async function closeMomentIfPossible(options?: {
  title?: string
  icon?: string
  isFragile?: boolean
}): Promise<boolean> {
  const sdk = await ensureMomentsSdk(options)
  if (!sdk?.close) return fallbackReturnToChat()

  try {
    await sdk.close()
  } catch {
    return fallbackReturnToChat()
  }
  return true
}
