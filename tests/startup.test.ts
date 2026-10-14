import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createStudioService } from '../src/backend/service'
import type { createBootstrapManager } from '../src/backend/bootstrap'
import type { BootstrapState } from '../src/shared/bootstrap'
import type { Snapshot, StudioService } from '../src/shared/contracts'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('启动被受控慢操作阻塞')), 2000) })])
  } finally { if (timer) clearTimeout(timer) }
}
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luckyx-startup-tests-'))
  const services: StudioService[] = [], releases: Array<() => void> = []
  t.after(async () => {
    for (const release of releases) release()
    for (const service of services) await service.dispose()
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('luckyx-startup-tests-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  async function environment(name: string) {
    const directory = path.join(root, name)
    await fs.mkdir(path.join(directory, 'python_embeded'), { recursive: true })
    await fs.mkdir(path.join(directory, 'ComfyUI'), { recursive: true })
    await fs.writeFile(path.join(directory, 'python_embeded/python.exe'), 'owned-fixture-python')
    await fs.writeFile(path.join(directory, 'ComfyUI/main.py'), 'owned-fixture-main')
    return directory
  }
  return { root, services, releases, environment }
}
function bootstrapFixture(ready: Promise<void>, state?: Partial<BootstrapState>) {
  const status: BootstrapState = { status: 'idle', phase: '', message: '', receivedBytes: 0, totalBytes: 0, completedFiles: 0, tutorialUrl: '', ...state }
  const observed = deferred<void>()
  const calls = { cancel: 0, dispose: 0, completed: 0, ready: 0 }
  const manager: ReturnType<typeof createBootstrapManager> = {
    get ready() { calls.ready++; observed.resolve(); return ready },
    completedInstallation: async () => { calls.completed++; if (!status.installationPath) throw new Error('no completed fixture'); return status.installationPath },
    plan: async () => { throw new Error('启动恢复不得重新获取安装清单') },
    start: async () => { throw new Error('启动恢复不得重新下载或安装') },
    cancel: () => { calls.cancel++; return structuredClone(status) },
    snapshot: () => structuredClone(status), subscribe: () => () => false,
    dispose: async () => { calls.dispose++ },
  }
  return { manager, observed, calls }
}
const hardware: Snapshot['hardware'] = { gpuName: 'NVIDIA GeForce RTX 4060', vramMb: 8192, ramGb: 32, driver: '580.88', cudaVersion: '13.0' }
function blockedEngine(t: TestContext) {
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    requests.push(String(input))
    const signal = init?.signal
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  return requests
}

test('服务工厂先返回可供窗口使用，snapshot等完整本地恢复，慢硬件与网络不阻塞首页', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = await fixture(t), gate = deferred<void>(), hardwareGate = deferred<Snapshot['hardware']>()
  f.releases.push(() => gate.resolve(), () => hardwareGate.resolve(hardware))
  const bootstrap = bootstrapFixture(gate.promise), requests = blockedEngine(t)
  const service = await within(createStudioService({ dataDir: path.join(f.root, 'data'), defaultInstallationPath: await f.environment('configured'), bootstrapManager: bootstrap.manager, hardwareProbe: () => hardwareGate.promise }))
  f.services.push(service)
  await within(bootstrap.observed.promise)
  const emissions: Snapshot[] = []; service.subscribe(snapshot => emissions.push(snapshot))
  let delivered = false
  const pending = service.invoke('snapshot').then(value => { delivered = true; return value as Snapshot })
  await Promise.resolve(); t.mock.timers.tick(7500)
  assert.equal(delivered, false); assert.equal(emissions.length, 0); assert.equal(requests.length, 0)
  gate.resolve()
  const snapshot = await within(pending)
  assert.equal(snapshot.settings.initialized, true, '已有环境不能短暂伪装成首次安装')
  assert.ok(emissions.length); assert.ok(emissions.every(value => value.settings.initialized))
  assert.equal(snapshot.hardware.gpuName, '检测中', '首页不等待nvidia-smi慢探测')
  await Promise.resolve(); t.mock.timers.tick(7500)
  assert.equal(requests.length, 1, '离线引擎慢请求只允许一条刷新链')
  await service.dispose()
  const emissionCount = emissions.length, requestCount = requests.length
  hardwareGate.resolve(hardware); await Promise.resolve(); t.mock.timers.tick(7500)
  assert.equal(emissions.length, emissionCount); assert.equal(requests.length, requestCount)
})

test('初始化期间退出不会发出半状态、后续刷新或在关闭数据库后补写', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = await fixture(t), gate = deferred<void>(), hardwareGate = deferred<Snapshot['hardware']>()
  f.releases.push(() => gate.resolve(), () => hardwareGate.resolve(hardware))
  const bootstrap = bootstrapFixture(gate.promise), requests = blockedEngine(t)
  const dataDir = path.join(f.root, 'data')
  const service = await within(createStudioService({ dataDir, bootstrapManager: bootstrap.manager, hardwareProbe: () => hardwareGate.promise }))
  f.services.push(service); await within(bootstrap.observed.promise)
  const emissions: Snapshot[] = []; service.subscribe(value => emissions.push(value))
  const shutdown = service.dispose()
  await Promise.resolve(); assert.equal(bootstrap.calls.cancel, 1)
  gate.resolve(); await within(shutdown)
  assert.equal(bootstrap.calls.dispose, 1); assert.equal(emissions.length, 0); assert.equal(requests.length, 0)
  hardwareGate.resolve(hardware); await Promise.resolve(); t.mock.timers.tick(10000)
  assert.equal(emissions.length, 0); assert.equal(requests.length, 0)
  await assert.rejects(fs.stat(path.join(dataDir, 'studio.sqlite')), { code: 'ENOENT' })
  await assert.rejects(service.invoke('snapshot'), /已关闭/)
})

test('本地恢复失败由首次snapshot明确报告，工厂与退出仍可完成', async t => {
  const f = await fixture(t), gate = deferred<void>()
  f.releases.push(() => gate.resolve())
  const bootstrap = bootstrapFixture(gate.promise), requests = blockedEngine(t)
  const service = await within(createStudioService({ dataDir: path.join(f.root, 'data'), bootstrapManager: bootstrap.manager, hardwareProbe: async () => hardware }))
  f.services.push(service); await within(bootstrap.observed.promise)
  const emissions: Snapshot[] = []; service.subscribe(value => emissions.push(value))
  const pending = service.invoke('snapshot')
  gate.reject(new Error('本地恢复记录暂时不可读取'))
  await assert.rejects(pending, /本地恢复记录暂时不可读取/)
  assert.equal(emissions.length, 0); assert.equal(requests.length, 0)
  await within(service.dispose())
})

test('首次配置保存被占用后重试可恢复，并发snapshot只重试一条初始化链', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = await fixture(t), gate = deferred<void>()
  f.releases.push(() => gate.resolve())
  const dataDir = path.join(f.root, 'data'), blocker = path.join(dataDir, 'studio.sqlite.tmp')
  await fs.mkdir(blocker, { recursive: true })
  const bootstrap = bootstrapFixture(gate.promise), requests = blockedEngine(t)
  let spawns = 0
  const service = await within(createStudioService({ dataDir, defaultInstallationPath: await f.environment('configured'), bootstrapManager: bootstrap.manager, hardwareProbe: async () => hardware,
    spawnEngine: (() => { spawns++; throw new Error('重试连接不得自行启动引擎') }) as typeof spawn }))
  f.services.push(service); await within(bootstrap.observed.promise)
  const emissions: Snapshot[] = []; service.subscribe(value => emissions.push(value))
  const initialSnapshot = service.invoke('snapshot')
  gate.resolve()
  await assert.rejects(initialSnapshot, error => ['EISDIR', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? ''))
  assert.equal(emissions.length, 0); assert.equal(requests.length, 0); assert.equal(bootstrap.calls.ready, 1)
  await fs.rmdir(blocker)
  const snapshots = await within(Promise.all(Array.from({ length: 8 }, () => service.invoke('snapshot') as Promise<Snapshot>)))
  assert.ok(snapshots.every(value => value.settings.initialized))
  assert.equal(bootstrap.calls.ready, 2, '重试失败初始化的并发调用只能启动一条恢复链')
  assert.equal(emissions.length, 1); assert.equal(spawns, 0)
  assert.ok((await fs.stat(path.join(dataDir, 'studio.sqlite'))).size > 0)
  await Promise.resolve(); assert.equal(requests.length, 1, '成功恢复后只在后台检查一次引擎')
})

test('已安装但路径尚未保存的启动恢复只连接本地目录，不等待引擎网络', async t => {
  const f = await fixture(t), requests = blockedEngine(t)
  const target = await f.environment('completed-installation')
  const bootstrap = bootstrapFixture(Promise.resolve(), { status: 'completed', installationPath: target })
  const service = await within(createStudioService({ dataDir: path.join(f.root, 'data'), defaultInstallationPath: path.join(f.root, 'missing-old-environment'), bootstrapManager: bootstrap.manager, hardwareProbe: async () => hardware }))
  f.services.push(service)
  const snapshot = await within(service.invoke('snapshot') as Promise<Snapshot>)
  assert.equal(snapshot.settings.installationPath, target); assert.equal(snapshot.settings.initialized, true)
  assert.equal(snapshot.engine.managed, false); assert.equal(bootstrap.calls.completed, 1)
  await Promise.resolve(); assert.equal(requests.length, 1, '外部引擎只在完成本地恢复后后台检查')
})

test('后台刷新尚未完成时启动引擎等待同一刷新链，不拿旧offline状态重复启动', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = await fixture(t), statsGate = deferred<Response>(), statsObserved = deferred<void>()
  f.releases.push(() => statsGate.resolve(Response.json({ system: {}, devices: [] })))
  const requests: string[] = []; let spawns = 0
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input); requests.push(url)
    if (url.endsWith('/system_stats')) {
      statsObserved.resolve()
      init?.signal?.addEventListener('abort', () => statsGate.reject(new Error('closed')), { once: true })
      return statsGate.promise
    }
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] })
    throw new Error(`unexpected endpoint: ${url}`)
  })
  const bootstrap = bootstrapFixture(Promise.resolve())
  const service = await within(createStudioService({ dataDir: path.join(f.root, 'data'), defaultInstallationPath: await f.environment('configured'), defaultEngineUrl: 'http://127.0.0.1:1', bootstrapManager: bootstrap.manager, hardwareProbe: async () => hardware,
    spawnEngine: (() => { spawns++; throw new Error('已有引擎不能重复启动') }) as typeof spawn }))
  f.services.push(service); await service.invoke('snapshot'); await within(statsObserved.promise)
  let started = false
  const pending = service.invoke('engine.start').then(value => { started = true; return value })
  await Promise.resolve(); t.mock.timers.tick(7500)
  assert.equal(started, false); assert.equal(spawns, 0); assert.equal(requests.length, 1)
  statsGate.resolve(Response.json({ system: { comfyui_version: 'owned-fixture' }, devices: [] }))
  await within(pending)
  assert.equal(started, true); assert.equal(spawns, 0)
  assert.equal(requests.filter(url => url.endsWith('/system_stats')).length, 1)
  assert.equal(requests.filter(url => url.endsWith('/queue')).length, 1)
})
