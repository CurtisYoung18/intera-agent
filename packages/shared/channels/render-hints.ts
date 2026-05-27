// S5 — Per-tool render hints.
// Operators tune how each tool appears on each channel without writing renderer code.

export type RenderHint =
  | CardHint
  | FormHint
  | PlainHint
  | ListHint
  | ImageHint

export interface CardHint {
  kind: 'card'
  buttonStyle?: 'inline' | 'block' | 'quick-reply'
  buttonAccent?: Record<string, 'default' | 'primary' | 'danger'>
  titleOverride?: string
}

export interface FormHint {
  kind: 'form'
  layout?: 'single' | 'multi'
  submitLabel?: string
}

export interface PlainHint {
  kind: 'plain'
  wrap?: 'quote' | 'code' | 'none'
}

export interface ListHint {
  kind: 'list'
  bulleted?: boolean
  showIndex?: boolean
}

export interface ImageHint {
  kind: 'image'
  urlPath: string
  altPath?: string
}

// ── Channel-specific render hints ──────────────────────────────────────────

export type LivechatRenderHint =
  | LivechatCardHint
  | LivechatCarouselHint
  | LivechatQuickRepliesHint
  | LivechatPlainHint

export interface LivechatCardHint {
  kind: 'card'
  titleField: string
  subtitleField?: string
  imageUrlField?: string
  buttons?: Array<{
    id: string
    postback: string
    labelField?: string
    labelStatic?: string
    type?: 'message' | 'url' | 'webview'
    url?: string
  }>
}

export interface LivechatCarouselHint {
  kind: 'carousel'
  itemsField: string
  idField?: string
  itemTemplate: {
    titleField: string
    subtitleField?: string
    imageUrlField?: string
    buttons?: Array<{
      id: string
      postback: string
      labelField?: string
      labelStatic?: string
      type?: 'message' | 'url' | 'webview'
      url?: string
    }>
  }
}

export interface LivechatQuickRepliesHint {
  kind: 'quick_replies'
  optionsField: string
  optionIdField?: string
  optionLabelField?: string
  titleStatic?: string
}

export interface LivechatPlainHint {
  kind: 'plain'
}
