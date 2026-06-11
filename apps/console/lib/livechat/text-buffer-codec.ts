const PREFIX = 'u16:'

export function encodeLivechatTextBuffer(text: string): string {
  if (!text) return ''
  return `${PREFIX}${Buffer.from(text, 'utf16le').toString('base64')}`
}

export function decodeLivechatTextBuffer(value: string): string {
  if (!value) return ''
  if (!value.startsWith(PREFIX)) return value
  return Buffer.from(value.slice(PREFIX.length), 'base64').toString('utf16le')
}
