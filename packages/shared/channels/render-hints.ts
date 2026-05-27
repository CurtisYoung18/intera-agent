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
