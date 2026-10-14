import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { publishEnvironmentDirectory, EnvironmentPublishError } from '../src/backend/publish-environment';

async function fixture(t: any) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luckyx-publish-tests-'));
    t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('luckyx-publish-tests-')); await fs.rm(root, { recursive: true, force: true }); });
    const source = path.join(root, '.cache/unpacked/ComfyUI_windows_portable'), target = path.join(root, 'luckyx-environment');
    await fs.mkdir(path.join(source, 'ComfyUI/models'), { recursive: true });
    await fs.writeFile(path.join(source, 'ComfyUI/models/verified.safetensors'), 'keep verified model');
    return { root, source, target, signal: new AbortController().signal };
}
const wait = async () => {};

test('瞬时EPERM、EBUSY、EACCES通过有限重试配置目录，原模型内容保持完整', async t => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
        const f = await fixture(t); let attempts = 0; const retries: number[] = [];
        await publishEnvironmentDirectory(f.source, f.target, { signal: f.signal, wait, onRetry: n => retries.push(n), rename: async (source, target) => { if (++attempts === 1) throw Object.assign(new Error('raw path'), { code }); await fs.rename(source, target); } });
        assert.equal(attempts, 2); assert.deepEqual(retries, [2]); assert.equal(await fs.readFile(path.join(f.target, 'ComfyUI/models/verified.safetensors'), 'utf8'), 'keep verified model'); await assert.rejects(fs.stat(f.source), { code: 'ENOENT' });
    }
});
test('永久权限或占用错误最多6次，不复制模型、不删除源目录，提示继续配置', async t => {
    const f = await fixture(t); let attempts = 0;
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, { signal: f.signal, wait, rename: async () => { attempts++; throw Object.assign(new Error('EPERM private path'), { code: 'EPERM' }); } }), error => {
        assert.ok(error instanceof EnvironmentPublishError); assert.match(error.message, /占用.*权限.*保留全部下载和模型.*继续配置环境/); assert.doesNotMatch(error.message, /private path|EPERM|驱动/); return true;
    });
    assert.equal(attempts, 6); assert.equal(await fs.readFile(path.join(f.source, 'ComfyUI/models/verified.safetensors'), 'utf8'), 'keep verified model'); await assert.rejects(fs.stat(f.target), { code: 'ENOENT' });
});
test('非暂时磁盘或路径错误立即失败，无意义重试不会消耗时间', async t => {
    for (const code of ['ENOENT', 'EXDEV', 'ENOSPC', 'EIO']) {
        const f = await fixture(t); let attempts = 0;
        await assert.rejects(publishEnvironmentDirectory(f.source, f.target, { signal: f.signal, wait, rename: async () => { attempts++; throw Object.assign(new Error('raw'), { code }); } }), /已保留下载文件和模型/); assert.equal(attempts, 1); assert.ok((await fs.stat(f.source)).isDirectory());
    }
});
test('重试期间用户创建目标目录立即停止，用户文件与缓存模型都不覆盖', async t => {
    const f = await fixture(t); let attempts = 0;
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, { signal: f.signal, wait: async () => { await fs.mkdir(f.target); await fs.writeFile(path.join(f.target, 'user.txt'), 'keep user'); }, rename: async () => { attempts++; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } }), /不会覆盖/);
    assert.equal(attempts, 1); assert.equal(await fs.readFile(path.join(f.target, 'user.txt'), 'utf8'), 'keep user'); assert.ok((await fs.stat(f.source)).isDirectory());
});
test('重试等待期间取消立即终止且保留源目录，之后不会发布目标', async t => {
    const f = await fixture(t); const controller = new AbortController(); let attempts = 0;
    await assert.rejects(publishEnvironmentDirectory(f.source, f.target, { signal: controller.signal, onRetry: () => controller.abort(), rename: async () => { attempts++; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } }), error => { assert.equal((error as Error).name, 'AbortError'); return true; });
    assert.equal(attempts, 1); assert.ok((await fs.stat(f.source)).isDirectory()); await assert.rejects(fs.stat(f.target), { code: 'ENOENT' });
});
