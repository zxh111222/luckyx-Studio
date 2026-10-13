const referenceHosts = new Set([
  'docs.comfy.org', 'github.com', 'huggingface.co',
  'comfyanonymous.github.io', 'raw.githubusercontent.com', 'blog.comfy.org',
])

/** Links shown by the model guide are public official documentation/model pages. */
export function validateReferenceUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('参考链接无效')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('参考链接无效') }
  if (url.protocol !== 'https:' || !referenceHosts.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('仅支持教程中列出的官方 HTTPS 链接')
  }
  return url.href
}
