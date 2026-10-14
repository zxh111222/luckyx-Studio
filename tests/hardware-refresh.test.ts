import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createStudioService } from '../src/backend/service'
import type { Hardware, Snapshot } from '../src/shared/contracts'
import type { BootstrapPlan } from '../src/shared/bootstrap'

test('重新检查配置读取当前驱动，旧3070驱动阻断下载，更新后无需清空数据', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luckyx-hardware-refresh-'))
  let hardware: Hardware = { gpuName: 'NVIDIA GeForce RTX 3070', vramMb: 8192, ramGb: 32, driver: '546.30', cudaVersion: '12.3' }
  const service = await createStudioService({ dataDir: path.join(root, 'data'), hardwareProbe: async () => hardware,
    bootstrapFetch: (async () => { return Response.json({ assets: [] }) }) as typeof fetch })
  t.after(async () => { await service.dispose(); assert.ok(path.basename(root).startsWith('luckyx-hardware-refresh-')); await fs.rm(root, { recursive: true, force: true }) })
  const first = await service.invoke('bootstrap.plan', { rootPath: path.join(root, 'install'), profile: 'h3' }) as BootstrapPlan
  assert.equal(first.runtime?.compatibility, 'driver-update-required'); assert.ok(first.hardwareIssues.some(issue => issue.includes('546.30')))
  const initial = await service.invoke('snapshot') as Snapshot
  hardware = { ...hardware, driver: '580.88', cudaVersion: '13.0' }
  const updated = await service.invoke('bootstrap.plan', { rootPath: path.join(root, 'install'), profile: 'h3' }) as BootstrapPlan
  assert.equal(updated.runtime?.compatibility, 'supported'); assert.deepEqual(updated.hardwareIssues, [])
  const refreshed = await service.invoke('snapshot') as Snapshot
  assert.equal(refreshed.hardware.driver, '580.88'); assert.equal(refreshed.hardware.cudaVersion, '13.0')
  assert.deepEqual(refreshed.tasks, initial.tasks); assert.deepEqual(refreshed.settings, initial.settings)
})

test('诊断更新硬件信息；驱动探测失败清除过时CUDA水平，不能当作可安装', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luckyx-hardware-refresh-'))
  let failed = false
  const service = await createStudioService({ dataDir: path.join(root, 'data'), hardwareProbe: async () => {
    if (failed) throw new Error('nvidia-smi unavailable')
    return { gpuName: 'NVIDIA GeForce RTX 3070', vramMb: 8192, ramGb: 32, driver: '580.88', cudaVersion: '13.0' }
  }, bootstrapFetch: (async () => Response.json({ assets: [] })) as typeof fetch })
  t.after(async () => { await service.dispose(); assert.ok(path.basename(root).startsWith('luckyx-hardware-refresh-')); await fs.rm(root, { recursive: true, force: true }) })
  failed = true
  const plan = await service.invoke('bootstrap.plan', { rootPath: path.join(root, 'install'), profile: 'environment' }) as BootstrapPlan
  assert.ok(plan.hardwareIssues.length); const snapshot = await service.invoke('snapshot') as Snapshot
  assert.equal(snapshot.hardware.driver, '未知'); assert.equal(snapshot.hardware.cudaVersion, undefined); assert.equal(snapshot.hardware.vramMb, 0)
})
