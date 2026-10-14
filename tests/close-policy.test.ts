import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseCloseAction, createCloseCoordinator, getCloseRuntimeSummary, parseClosePreferences, validateClosePreference, type ClosePreference, type CloseRequest, type CloseRuntimeSummary } from '../src/shared/close-policy'

const idle: CloseRuntimeSummary = { activeTasks: 0, activeDownloads: false, managedEngine: false, externalEngine: false }
const idleSnapshot = { tasks: [], engine: { status: 'offline' as const, managed: false, queue: 0, message: '' } }

test('安装恢复未返回时关闭状态在短期限内可用，并保守提醒有后台安装', { timeout: 500 }, async () => {
  const summary = await getCloseRuntimeSummary(idleSnapshot, new Promise(() => {}), 10)
  assert.deepEqual(summary, { ...idle, activeDownloads: true })
})

test('关闭状态保留即时任务与外部引擎信息，安装读取失败也继续确认', async () => {
  const snapshot = { ...idleSnapshot, engine: { ...idleSnapshot.engine, status: 'busy' as const, queue: 2 } }
  assert.deepEqual(await getCloseRuntimeSummary(snapshot, Promise.resolve({ status: 'completed' })), { ...idle, activeTasks: 2, externalEngine: true })
  assert.equal((await getCloseRuntimeSummary(idleSnapshot, Promise.reject(new Error('restore failed')))).activeDownloads, true)
})

function harness(overrides: { preference?: ClosePreference; runtime?: CloseRuntimeSummary; setFails?: boolean; actionFails?: boolean } = {}) {
  let preference = overrides.preference ?? 'ask'
  const requests: CloseRequest[] = []
  const events: string[] = []
  let failWrite = Boolean(overrides.setFails)
  let failAction = Boolean(overrides.actionFails)
  const coordinator = createCloseCoordinator({
    getPreference: () => preference,
    async setPreference(value) { if (failWrite) throw new Error('disk error'); preference = value; events.push('save:' + value) },
    async getRuntime() { return overrides.runtime ?? idle },
    nextId: () => 'request-1',
    notify: request => requests.push(request),
    async perform(action) { if (failAction) throw new Error('tray unavailable'); events.push('perform:' + action) }
  })
  return { coordinator, requests, events, preference: () => preference, allowWrite: () => { failWrite = false }, allowAction: () => { failAction = false } }
}

test('关闭偏好首次或损坏输入恢复询问，有效行为可跨版本保留', () => {
  for (const raw of [null, undefined, '', 'broken', 'null', '[]', '{"behavior":"delete"}']) assert.deepEqual(parseClosePreferences(raw), { behavior: 'ask' })
  for (const behavior of ['ask', 'background', 'quit'] as const) assert.deepEqual(parseClosePreferences(JSON.stringify({ version: 1, behavior })), { behavior })
  assert.throws(() => validateClosePreference(true), /关闭行为无效/)
})

test('托盘显式退出忽略继续后台偏好，运行任务或下载时仍确认', () => {
  assert.equal(chooseCloseAction('background', 'tray', idle), 'quit')
  assert.equal(chooseCloseAction('quit', 'tray', { ...idle, activeTasks: 1 }), 'ask')
  assert.equal(chooseCloseAction('background', 'tray', { ...idle, activeDownloads: true }), 'ask')
  assert.equal(chooseCloseAction('background', 'window', { ...idle, activeTasks: 2, activeDownloads: true }), 'background')
})

test('首次关闭仅通知界面，不停止任务、下载或外部引擎', async () => {
  const runtime = { ...idle, activeTasks: 2, activeDownloads: true, externalEngine: true }
  const h = harness({ runtime })
  await h.coordinator.request('window')
  assert.deepEqual(h.requests, [{ ...runtime, id: 'request-1', source: 'window' }])
  assert.deepEqual(h.events, [])
})

test('同一个窗口重复关闭不会重复弹窗或重复执行', async () => {
  const h = harness()
  const [a, b] = await Promise.all([h.coordinator.request('window'), h.coordinator.request('window')])
  assert.deepEqual(a, b)
  assert.equal(h.requests.length, 1)
  await h.coordinator.request('window')
  assert.equal(h.requests.length, 1)
})

test('继续后台一次不改默认行为，后续关闭仍询问', async () => {
  const h = harness({ runtime: { ...idle, activeDownloads: true, managedEngine: true } })
  await h.coordinator.request('window')
  await h.coordinator.resolve({ id: 'request-1', action: 'background' })
  assert.deepEqual(h.events, ['perform:background'])
  assert.equal(h.preference(), 'ask')
  assert.equal(h.coordinator.current(), null)
  await h.coordinator.request('window')
  assert.equal(h.requests.length, 2)
})

test('记住明确选择先落盘，再隐藏或退出；取消不持久化', async () => {
  const h = harness()
  await h.coordinator.request('window')
  await h.coordinator.resolve({ id: 'request-1', action: 'cancel', remember: true })
  assert.deepEqual(h.events, [])
  await h.coordinator.request('window')
  await h.coordinator.resolve({ id: 'request-1', action: 'background', remember: true })
  assert.deepEqual(h.events, ['save:background', 'perform:background'])
  await h.coordinator.request('window')
  assert.equal(h.requests.length, 2)
  assert.equal(h.events.at(-1), 'perform:background')
})

test('失效编号与非法操作不会改变后台状态或清除当前请求', async () => {
  const h = harness()
  await h.coordinator.request('window')
  await assert.rejects(h.coordinator.resolve({ id: 'stale', action: 'quit' }), /已失效/)
  await assert.rejects(h.coordinator.resolve({ id: 'request-1', action: 'delete' }), /操作无效/)
  await assert.rejects(h.coordinator.resolve({ id: 'request-1', action: 'quit', remember: 'yes' }), /格式无效/)
  assert.ok(h.coordinator.current())
  assert.deepEqual(h.events, [])
})

test('偏好写入失败保持窗口待选择，恢复后可重试', async () => {
  const h = harness({ setFails: true })
  await h.coordinator.request('window')
  await assert.rejects(h.coordinator.resolve({ id: 'request-1', action: 'background', remember: true }), /disk error/)
  assert.deepEqual(h.events, [])
  assert.ok(h.coordinator.current())
  h.allowWrite()
  await h.coordinator.resolve({ id: 'request-1', action: 'background', remember: true })
  assert.deepEqual(h.events, ['save:background', 'perform:background'])
})

test('后台或退出执行失败可重试，不进入不可恢复的退出状态', async () => {
  const h = harness({ actionFails: true })
  await h.coordinator.request('window')
  await assert.rejects(h.coordinator.resolve({ id: 'request-1', action: 'quit' }), /tray unavailable/)
  assert.equal(h.coordinator.isQuitting(), false)
  assert.ok(h.coordinator.current())
  h.allowAction()
  await h.coordinator.resolve({ id: 'request-1', action: 'quit' })
  assert.deepEqual(h.events, ['perform:quit'])
  await h.coordinator.request('window')
  assert.equal(h.requests.length, 1)
})

test('记住退出时不再弹窗，显式托盘退出有任务时保留确认', async () => {
  const windowClose = harness({ preference: 'quit' })
  await windowClose.coordinator.request('window')
  assert.equal(windowClose.requests.length, 0)
  assert.deepEqual(windowClose.events, ['perform:quit'])
  const trayClose = harness({ preference: 'quit', runtime: { ...idle, activeTasks: 1 } })
  await trayClose.coordinator.request('tray')
  assert.equal(trayClose.requests[0].source, 'tray')
  assert.deepEqual(trayClose.events, [])
})

test('界面关闭通知失败不留下失效请求，后续可重新显示', async () => {
  let fail = true
  const requests: CloseRequest[] = []
  const coordinator = createCloseCoordinator({
    getPreference: () => 'ask', setPreference: async () => {},
    getRuntime: async () => idle, nextId: () => 'request-1', perform: async () => {},
    notify(request) { if (fail) throw new Error('renderer gone'); requests.push(request) }
  })
  await assert.rejects(coordinator.request('window'), /renderer gone/)
  assert.equal(coordinator.current(), null)
  fail = false
  await coordinator.request('window')
  assert.equal(requests.length, 1)
})

test('选择正在保存时不能重复执行第二个退出操作', async () => {
  let finish: (() => void) | undefined
  let performed = 0
  const coordinator = createCloseCoordinator({
    getPreference: () => 'ask', setPreference: async () => {},
    getRuntime: async () => idle, nextId: () => 'request-1', notify: () => {},
    perform: () => new Promise<void>(resolve => { performed++; finish = resolve })
  })
  await coordinator.request('window')
  const first = coordinator.resolve({ id: 'request-1', action: 'background' })
  await assert.rejects(coordinator.resolve({ id: 'request-1', action: 'quit' }), /正在处理/)
  assert.equal(performed, 1)
  finish?.()
  await first
})
