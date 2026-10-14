import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { createBootstrapFetch } from '../src/main/bootstrap-network'

function transport(action: (client: EventEmitter) => void) {
  let options: any, aborts = 0
  const headers: Record<string, string> = {}
  const client = Object.assign(new EventEmitter(), { setHeader: (key: string, value: string) => { headers[key] = value }, end: () => queueMicrotask(() => action(client)), abort: () => { aborts++ } })
  const fetcher = createBootstrapFetch(value => { options = value; return client as any })
  return { fetcher, client, headers, options: () => options, aborts: () => aborts }
}
function response(body: Readable, status = 206) { return Object.assign(body, { statusCode: status, headers: { 'content-range': 'bytes 2-4/5', 'content-length': '3' } }) }

test('系统网络通道保持Range头和流式响应，允许调用方校验重定向', async () => {
  const t = transport(client => client.emit('response', response(Readable.from([Buffer.from('cde')]))))
  const result = await t.fetcher('https://huggingface.co/file', { redirect: 'manual', headers: { Range: 'bytes=2-', 'Accept-Encoding': 'identity' } })
  assert.equal(result.status, 206); assert.equal(result.headers.get('content-range'), 'bytes 2-4/5'); assert.equal(await result.text(), 'cde')
  assert.equal(t.headers.range, 'bytes=2-'); assert.equal(t.headers['accept-encoding'], 'identity')
  assert.equal(t.options().redirect, 'manual'); assert.equal(t.options().useSessionCookies, false)
})
test('重定向返回Location后终止请求，绝不自动跟随未经检查的来源', async () => {
  const t = transport(client => client.emit('redirect', 302, 'GET', 'https://outside.test/file', {}))
  const result = await t.fetcher('https://huggingface.co/file', { redirect: 'manual' })
  assert.equal(result.status, 302); assert.equal(result.headers.get('location'), 'https://outside.test/file'); assert.equal(t.aborts(), 1)
})
test('清单请求要求redirect error时直接拒绝重定向', async () => {
  const t = transport(client => client.emit('redirect', 302, 'GET', 'https://outside.test/file', {}))
  await assert.rejects(t.fetcher('https://api.github.com/file', { redirect: 'error' }), /非预期重定向/); assert.equal(t.aborts(), 1)
})
test('暂停下载会中断请求和未结束的响应流', async () => {
  const body = new Readable({ read() {} }), controller = new AbortController()
  const t = transport(client => client.emit('response', response(body)))
  const result = await t.fetcher('https://huggingface.co/file', { signal: controller.signal })
  const reading = result.text(); controller.abort()
  await assert.rejects(reading); assert.equal(t.aborts(), 1); assert.equal(body.destroyed, true)
})
test('响应中途aborted能通知reader而不是永久等待', async () => {
  const body = new Readable({ read() {} })
  const t = transport(client => client.emit('response', response(body)))
  const result = await t.fetcher('https://huggingface.co/file'); const reading = result.text()
  body.emit('aborted'); await assert.rejects(reading, /下载连接中断/)
})
test('取消响应body会停止底层请求，不在后台继续接收大文件', async () => {
  const body = new Readable({ read() {} })
  const t = transport(client => client.emit('response', response(body)))
  const result = await t.fetcher('https://huggingface.co/file'); await result.body!.cancel()
  await new Promise(resolve => setImmediate(resolve)); assert.equal(t.aborts(), 1)
})
test('网络错误和已取消的请求不会被包装为成功文件', async () => {
  const t = transport(client => client.emit('error', new Error('net::ERR_CONNECTION_RESET')))
  await assert.rejects(t.fetcher('https://huggingface.co/file'), /ERR_CONNECTION_RESET/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(t.fetcher('https://huggingface.co/file', { signal: controller.signal }), { name: 'AbortError' })
  await assert.rejects(t.fetcher('https://huggingface.co/file', { method: 'POST' }), /只支持 GET/)
})
