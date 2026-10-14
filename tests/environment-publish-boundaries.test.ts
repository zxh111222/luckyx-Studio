import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { publishEnvironmentDirectory, EnvironmentPublishError } from '../src/backend/publish-environment'

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luckyx-publish-boundary-'))
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('luckyx-publish-boundary-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const source = path.join(root, '.luckyx-bootstrap', 'unpacked', 'ComfyUI_windows_portable')
  const target = path.join(root, 'luckyx-environment')
  const model = path.join(source, 'ComfyUI', 'models', 'weights.safetensors')
  await fs.mkdir(path.dirname(model), { recursive: true }); await fs.writeFile(model, 'verified-model-keep')
  const controller = new AbortController()
  return { root, source, target, model, controller }
}
const blocked = (code: string) => Object.assign(new Error(`mock ${code}`), { code })

test('已有文件、空目录及有数据目录均不能被移动覆盖', async t => {
  for (const kind of ['file', 'empty-directory', 'user-directory']) {
    const f = await fixture(t)
    if (kind === 'file') await fs.writeFile(f.target, 'user-file-keep')
    else { await fs.mkdir(f.target); if (kind === 'user-directory') await fs.writeFile(path.join(f.target, 'mine.txt'), 'user-directory-keep') }
    let renames = 0, waits = 0
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, { signal: f.controller.signal, rename: async () => { renames++ }, wait: async () => { waits++ } }), /不会覆盖/)
    assert.equal(renames, 0); assert.equal(waits, 0)
    assert.equal(await fs.readFile(f.model, 'utf8'), 'verified-model-keep')
    if (kind === 'file') assert.equal(await fs.readFile(f.target, 'utf8'), 'user-file-keep')
    if (kind === 'user-directory') assert.equal(await fs.readFile(path.join(f.target, 'mine.txt'), 'utf8'), 'user-directory-keep')
  }
})

test('短暂占用后目标突然出现，下一次尝试立即停止并保留双方文件', async t => {
  for (const kind of ['file', 'directory']) {
    const f = await fixture(t); let renames = 0, waits = 0
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, {
      signal: f.controller.signal,
      rename: async () => { renames++; throw blocked('EPERM') },
      wait: async () => { waits++; if (kind === 'file') await fs.writeFile(f.target, 'new-user-file'); else { await fs.mkdir(f.target); await fs.writeFile(path.join(f.target, 'mine.txt'), 'new-user-file') } },
    }), /不会覆盖/)
    assert.equal(renames, 1); assert.equal(waits, 1)
    assert.equal(await fs.readFile(f.model, 'utf8'), 'verified-model-keep')
    assert.equal(await fs.readFile(kind === 'file' ? f.target : path.join(f.target, 'mine.txt'), 'utf8'), 'new-user-file')
  }
})

test('目标junction、来源junction及来源内部junction均拒绝，不触碰链接背后的数据', async t => {
  for (const kind of ['target', 'source', 'nested-source', 'source-parent']) {
    const f = await fixture(t)
    const external = path.join(f.root, 'other-user-directory')
    await fs.mkdir(external); await fs.writeFile(path.join(external, 'keep.txt'), 'external-keep')
    if (kind === 'target') await fs.symlink(external, f.target, 'junction')
    else if (kind === 'source') { await fs.rename(f.source, path.join(f.root, 'saved-source')); await fs.symlink(external, f.source, 'junction') }
    else if (kind === 'nested-source') await fs.symlink(external, path.join(f.source, 'linked-node'), 'junction')
    else { const parent = path.dirname(f.source); await fs.rename(parent, path.join(f.root, 'saved-parent')); await fs.symlink(external, parent, 'junction') }
    let renames = 0
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, { signal: f.controller.signal, rename: async () => { renames++ } }), EnvironmentPublishError)
    assert.equal(renames, 0); assert.equal(await fs.readFile(path.join(external, 'keep.txt'), 'utf8'), 'external-keep')
    if (kind === 'nested-source') assert.equal(await fs.readFile(f.model, 'utf8'), 'verified-model-keep')
  }
})

test('重试等待期间来源新出现junction，也必须重新检查后停止', async t => {
  const f = await fixture(t); let renames = 0
  const external = path.join(f.root, 'user-data'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'keep.txt'), 'keep')
  await assert.rejects(publishEnvironmentDirectory(f.source, f.target, {
    signal: f.controller.signal,
    rename: async () => { renames++; throw blocked('EBUSY') },
    wait: async () => { await fs.symlink(external, path.join(f.source, 'late-junction'), 'junction') },
  }), /链接/)
  assert.equal(renames, 1); assert.equal(await fs.readFile(f.model, 'utf8'), 'verified-model-keep')
  assert.equal(await fs.readFile(path.join(external, 'keep.txt'), 'utf8'), 'keep')
})

test('目录列表返回后普通模型文件被替换成junction，旧Dirent不能放行移动', { concurrency: false }, async t => {
  const f = await fixture(t)
  const outsideSource = path.join(f.root, 'outside-source-owned')
  const originalModel = path.join(f.root, 'saved-original-model.safetensors')
  await fs.mkdir(outsideSource); await fs.writeFile(path.join(outsideSource, 'keep.txt'), 'outside-keep')
  const originalReaddir = fs.readdir
  let changed = false, renames = 0
  const restore = () => { fs.readdir = originalReaddir }
  t.after(restore)
  fs.readdir = (async (...args: unknown[]) => {
    const listing = await Reflect.apply(originalReaddir, fs, args)
    if (!changed && path.resolve(String(args[0])) === path.dirname(f.model)) {
      const entries = listing as Array<{ name: string; isFile(): boolean }>
      assert.equal(entries.find(entry => entry.name === path.basename(f.model))?.isFile(), true, '受控竞争必须从普通文件的旧Dirent开始')
      changed = true
      await fs.rename(f.model, originalModel)
      await fs.symlink(outsideSource, f.model, 'junction')
    }
    return listing
  }) as typeof fs.readdir
  try {
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, {
      signal: f.controller.signal, rename: async () => { renames++ },
    }), /含文件或目录链接/)
    assert.equal(changed, true); assert.equal(renames, 0)
    assert.equal(await fs.readFile(originalModel, 'utf8'), 'verified-model-keep')
    assert.equal(await fs.readFile(path.join(outsideSource, 'keep.txt'), 'utf8'), 'outside-keep')
    await assert.rejects(fs.stat(f.target), { code: 'ENOENT' })
  } finally { restore() }
})

test('永久权限或占用问题只重试固定次数，并保留完整缓存等待用户处理', async t => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const f = await fixture(t); let renames = 0; const delays: number[] = []
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, {
      signal: f.controller.signal, rename: async () => { renames++; throw blocked(code) }, wait: async delay => { delays.push(delay) },
    }), /已自动重试并保留全部下载和模型/)
    assert.equal(renames, 6); assert.deepEqual(delays, [250, 500, 1000, 1500, 2000])
    assert.equal(await fs.readFile(f.model, 'utf8'), 'verified-model-keep'); await assert.rejects(fs.stat(f.target), { code: 'ENOENT' })
  }
})

test('跨磁盘、磁盘不足、源丢失及其他错误及时失败，不触发复制或长时间重试', async t => {
  for (const code of ['EXDEV', 'ENOSPC', 'ENOENT', 'EIO']) {
    const f = await fixture(t); let renames = 0, waits = 0
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, {
      signal: f.controller.signal, rename: async () => { renames++; throw blocked(code) }, wait: async () => { waits++ },
    }), /保留下载文件和模型/)
    assert.equal(renames, 1); assert.equal(waits, 0); assert.equal(await fs.readFile(f.model, 'utf8'), 'verified-model-keep')
    await assert.rejects(fs.stat(f.target), { code: 'ENOENT' })
  }
})

test('重试期间来源被移走时不尝试重新下载或移动其他目录', async t => {
  const f = await fixture(t); let renames = 0, waits = 0
  const parked = path.join(f.root, 'user-parked-source')
  await assert.rejects(publishEnvironmentDirectory(f.source, f.target, {
    signal: f.controller.signal, rename: async () => { renames++; throw blocked('EPERM') },
    wait: async () => { waits++; await fs.rename(f.source, parked) },
  }), /保留下载文件和模型/)
  assert.equal(renames, 1); assert.equal(waits, 1)
  assert.equal(await fs.readFile(path.join(parked, 'ComfyUI/models/weights.safetensors'), 'utf8'), 'verified-model-keep')
  await assert.rejects(fs.stat(f.target), { code: 'ENOENT' })
})

test('开始前取消或等待期间取消均立即中止，保留源目录且不继续重试', async t => {
  for (const phase of ['before', 'waiting']) {
    const f = await fixture(t); let renames = 0, waits = 0
    const reason = new Error('用户暂停安装')
    if (phase === 'before') f.controller.abort(reason)
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, {
      signal: f.controller.signal, rename: async () => { renames++; throw blocked('EPERM') },
      wait: async (_delay, signal) => { waits++; assert.equal(signal, f.controller.signal); f.controller.abort(reason); signal.throwIfAborted() },
    }), error => error === reason)
    assert.equal(renames, phase === 'before' ? 0 : 1); assert.equal(waits, phase === 'before' ? 0 : 1)
    assert.equal(await fs.readFile(f.model, 'utf8'), 'verified-model-keep'); await assert.rejects(fs.stat(f.target), { code: 'ENOENT' })
  }
})

test('真实发布只移动同一个目录和模型inode，目录外来源不允许移动', async t => {
  const f = await fixture(t)
  const directoryBefore = await fs.stat(f.source), modelBefore = await fs.stat(f.model)
  await publishEnvironmentDirectory(f.source, f.target, { signal: f.controller.signal })
  const directoryAfter = await fs.stat(f.target), modelAfter = await fs.stat(path.join(f.target, 'ComfyUI/models/weights.safetensors'))
  assert.equal(directoryAfter.ino, directoryBefore.ino); assert.equal(modelAfter.ino, modelBefore.ino)
  assert.equal(await fs.readFile(path.join(f.target, 'ComfyUI/models/weights.safetensors'), 'utf8'), 'verified-model-keep')
  await assert.rejects(fs.stat(f.source), { code: 'ENOENT' })
  let renames = 0
  await assert.rejects(publishEnvironmentDirectory(f.target, path.join(f.root, 'another-parent', 'environment'), {
    signal: f.controller.signal, rename: async () => { renames++ },
  }), /不能跨目录移动/)
  assert.equal(renames, 0); assert.equal(await fs.readFile(path.join(f.target, 'ComfyUI/models/weights.safetensors'), 'utf8'), 'verified-model-keep')
})
