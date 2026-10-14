import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createStudioService } from '../src/backend/service'

const service = await createStudioService({ dataDir: resolve('.runtime/userData') })
const commands = new Set(['snapshot', 'engine.start', 'engine.stop', 'engine.restart', 'settings.save', 'task.submit', 'task.cancel', 'task.retry', 'tasks.refresh', 'preset.save', 'diagnostics.run', 'template.validate', 'resource.scan', 'logs.clear', 'workflow.create', 'workflow.import', 'workflow.list', 'workflow.get', 'workflow.update', 'workflow.rename', 'workflow.remove'])
commands.add('workflow.recipes')
commands.add('task.remove')
commands.add('workflow.recipeImport')
commands.add('bootstrap.status')
commands.add('bootstrap.plan')
const allowedOrigins = new Set(['http://127.0.0.1:4173', 'http://localhost:4173'])
const server = createHttpServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Cache-Control', 'no-store')
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1:4180')
    const host = (request.headers.host || '').split(':')[0]
    if (!['localhost', '127.0.0.1'].includes(host)) { response.writeHead(403); response.end('Localhost only'); return }
    if (url.pathname === '/api/rpc' && request.method === 'POST') {
      if (!allowedOrigins.has(request.headers.origin || '') || !request.headers['content-type']?.startsWith('application/json')) {
        response.writeHead(403); response.end(JSON.stringify({ ok: false, error: '无效调用来源' })); return
      }
      let length = 0
      const chunks: Buffer[] = []
      for await (const chunk of request) { length += chunk.length; if (length > 15 * 1024 * 1024) throw new Error('请求内容超过限制'); chunks.push(chunk) }
      const { command, payload } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!commands.has(command)) throw new Error('不支持的操作')
      const value = await service.invoke(command, payload)
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ ok: true, value }))
      return
    }
    if (url.pathname === '/api/media' && request.method === 'GET') {
      const media = await service.resolveMedia(url.searchParams.get('taskId') || '', Number(url.searchParams.get('index')))
      const headers: Record<string, string> = {}
      if (request.headers.range) headers.Range = request.headers.range
      const source = await fetch(media.url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) })
      if (!source.ok || !source.body) throw new Error('视频文件无法读取')
      response.writeHead(source.status, {
        'Content-Type': source.headers.get('content-type') || 'video/mp4',
        ...(source.headers.get('content-length') ? { 'Content-Length': source.headers.get('content-length')! } : {}),
        ...(source.headers.get('content-range') ? { 'Content-Range': source.headers.get('content-range')! } : {}),
        'Accept-Ranges': 'bytes',
        ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(media.filename)}` } : {})
      })
      await pipeline(Readable.fromWeb(source.body as never), response)
      return
    }
    response.writeHead(404); response.end('Not found')
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '本地操作失败' }))
    } else response.destroy()
  }
})
await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(4180, '127.0.0.1', done) })
const vite = await createViteServer({ configFile: resolve('vite.config.ts') })
await vite.listen()
console.log('luckyx. Studio 预览：http://127.0.0.1:4173')
let closing = false
async function close() { if (closing) return; closing = true; await vite.close(); server.close(); await service.dispose(); process.exit(0) }
process.on('SIGINT', () => void close())
process.on('SIGTERM', () => void close())
