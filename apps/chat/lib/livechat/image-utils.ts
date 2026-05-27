// apps/chat/lib/livechat/image-utils.ts
// Downloads images from external URLs and encodes as base64 for multimodal API.

export async function downloadAndEncode(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download image from ${url}: ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  return buffer.toString('base64')
}
