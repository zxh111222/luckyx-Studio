import { Readable } from 'node:stream'
import type { ClientRequest, ClientRequestConstructorOptions } from 'electron'

/** Chromium networking uses the system proxy; redirects stay under the installer's allowlist. */
export function createBootstrapFetch(request: (options: ClientRequestConstructorOptions) => ClientRequest): typeof fetch {
  return async (input, init = {}) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
    if ((init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase() !== 'GET' || init.body)
      throw new Error('安装下载只支持 GET 请求')
    init.signal?.throwIfAborted()
    return await new Promise<Response>((resolve, reject) => {
      const client = request({ url, method: 'GET', redirect: 'manual', useSessionCookies: false })
      let settled = false
      let requestAborted = false
      const stop = () => { if (!requestAborted) { requestAborted = true; client.abort() } }
      let stream: Readable | undefined
      const cleanup = () => init.signal?.removeEventListener('abort', abort)
      const abort = () => {
        const error = init.signal?.reason ?? new DOMException('Aborted', 'AbortError')
        stream?.destroy(error); stop(); cleanup()
        if (!settled) { settled = true; reject(error) }
      }
      init.signal?.addEventListener('abort', abort, { once: true })
      const responseHeaders = (values: Record<string, string | string[] | undefined>) => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(key, item)
        return headers
      }
      client.on('error', error => { stream?.destroy(error); if (!settled) { settled = true; cleanup(); reject(error) } })
      client.on('redirect', (status, _method, target, values) => {
        if (settled) return
        if (init.redirect === 'error') { settled = true; cleanup(); reject(new Error('下载来源出现非预期重定向')); stop(); return }
        const headers = responseHeaders(values); headers.set('location', target)
        settled = true; cleanup(); resolve(new Response(null, { status, headers })); stop()
      })
      client.on('response', response => {
        if (settled) return
        try {
          stream = response as unknown as Readable
          stream.once('close', () => { cleanup(); if (!stream?.readableEnded) stop() })
          const body = [204, 205, 304].includes(response.statusCode) ? null : Readable.toWeb(stream) as ReadableStream<Uint8Array>
          const result = new Response(body, { status: response.statusCode, headers: responseHeaders(response.headers) })
          response.once('end', cleanup); response.once('aborted', () => { stream?.destroy(new Error('下载连接中断')); cleanup() }); response.once('error', cleanup)
          settled = true; resolve(result)
        } catch (error) { settled = true; cleanup(); stop(); reject(error) }
      })
      try {
        const headers = new Headers(init.headers)
        for (const [key, value] of headers) client.setHeader(key, value)
        if (init.signal?.aborted) abort()
        else client.end()
      } catch (error) { settled = true; cleanup(); stop(); reject(error) }
    })
  }
}
