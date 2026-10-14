import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createBootstrapManager } from '../src/backend/bootstrap';
import { getPinnedH3Files } from '../src/backend/h3-downloads';
import { h3ModelSpecs } from '../src/shared/h3-installation';
import { createStudioService } from '../src/backend/service';
import type { Snapshot, StudioService } from '../src/shared/contracts';
import graph from '../src/backend/workflows/h3-i2v.json';

async function fixture(t: any) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luckyx-bootstrap-service-'));
    const dataDir = path.join(root, 'data'), installRoot = path.join(root, 'installed'), old = path.join(root, 'old');
    const blob = Buffer.from('small-bootstrap-fixture'), sha256 = createHash('sha256').update(blob).digest('hex');
    const write = async (file: string, content: string | Buffer = blob) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
    const official = 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.39.0/ComfyUI_windows_portable_nvidia.7z';
    const options = { dataDir, sevenZipPath: 'fixture-7za.exe', getHardware: async () => ({ gpuName: 'NVIDIA GeForce RTX 4060', vramMb: 8192, ramGb: 16, driver: '590.01' }), getFreeBytes: async () => 1024 ** 4,
        getModelFiles: (tier: Parameters<typeof getPinnedH3Files>[0]) => getPinnedH3Files(tier).map(file => ({ ...file, sizeBytes: blob.length, sha256 })),
        fetch: (async (input: any) => String(input).includes('api.github.com') ? Response.json({ assets: [{ name: 'ComfyUI_windows_portable_nvidia.7z', size: blob.length, digest: 'sha256:' + sha256, browser_download_url: official }] }) : new Response(blob)) as typeof fetch,
        runner: async (_exe: string, args: string[]) => {
            const node = getPinnedH3Files('lite').find(file => file.kind === 'node' && args.some(arg => arg.endsWith(file.name)));
            if (args[0] === 'l') return { stdout: '----------\nPath = ' + (node ? node.archiveRoot + '/__init__.py' : 'ComfyUI_windows_portable/ComfyUI/main.py') };
            if (args[0] === 'x') { const extracted = args.find(arg => arg.startsWith('-o'))!.slice(2); if (node) await write(path.join(extracted, node.archiveRoot!, '__init__.py')); else { await write(path.join(extracted, 'ComfyUI_windows_portable/python_embeded/python.exe')); await write(path.join(extracted, 'ComfyUI_windows_portable/ComfyUI/main.py')); } return { stdout: '' }; }
            return { stdout: JSON.stringify({ available: true, cuda: '13.0' }) };
        } };
    const installed = createBootstrapManager(options); const plan = await installed.plan({ rootPath: installRoot, hardware: await options.getHardware() }); assert.equal((await installed.start(plan)).status, 'completed'); await installed.dispose();
    await write(path.join(old, 'python_embeded/python.exe')); await write(path.join(old, 'ComfyUI/main.py'));
    for (const [folder, name] of h3ModelSpecs('standard')) await write(path.join(old, 'ComfyUI/models', folder, name));
    const engine = { valid: false, pending: [] as any[], calls: [] as string[] };
    const server = createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk; engine.calls.push(req.url!); res.setHeader('Content-Type', 'application/json');
        if (req.url === '/system_stats') res.end(JSON.stringify(engine.valid ? { system: { comfyui_version: 'fixture' }, devices: [] } : {}));
        else if (req.url === '/queue') res.end(JSON.stringify({ queue_pending: engine.pending, queue_running: [] }));
        else if (req.url === '/object_info') res.end(JSON.stringify(Object.fromEntries(Object.values(graph).map(node => [node.class_type, { input: { required: {} } }]))));
        else if (req.url === '/prompt') { const payload = JSON.parse(body); engine.pending.push([0, 'queued-task', payload.prompt, payload.extra_data]); res.end(JSON.stringify({ prompt_id: 'queued-task' })); }
        else if (req.url?.startsWith('/history/')) res.end('{}');
        else { res.statusCode = 404; res.end('{}'); }
    }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); server.on('upgrade', (_req, socket) => socket.destroy());
    const engineUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const services: StudioService[] = [];
    t.after(async () => { for (const service of services) await service.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); assert.ok(path.basename(root).startsWith('luckyx-bootstrap-service-')); await fs.rm(root, { recursive: true, force: true }); });
    async function create(initialPath = old) { const service = await createStudioService({ dataDir, defaultInstallationPath: initialPath, defaultEngineUrl: engineUrl, bootstrapManager: createBootstrapManager(options) }); services.push(service); return service; }
    return { root, dataDir, target: plan.targetPath, old, engine, create };
}
test('安装已完成但SQLite尚未配置时，重启自动恢复可信目标和Lite四模型，不自动启动引擎', async t => {
    const f = await fixture(t), service = await f.create(path.join(f.root, 'missing-old-environment'));
    const snapshot = await service.invoke('snapshot') as Snapshot; assert.equal(snapshot.settings.installationPath, f.target); assert.equal(snapshot.settings.initialized, true); assert.equal(snapshot.templates[0].installationTier, 'lite'); assert.equal(snapshot.resources.length, 4); assert.equal(snapshot.engine.managed, false);
    await service.dispose(); const restored = await f.create(); const next = await restored.invoke('snapshot') as Snapshot; assert.equal(next.settings.installationPath, f.target); assert.equal(next.templates[0].defaultSteps, 20); assert.equal(next.resources.length, 4);
});
test('已有有效环境不自动切换；手动连接仅采用已完成安装的可信路径并幂等', async t => {
    const f = await fixture(t), service = await f.create(); assert.equal((await service.invoke('snapshot') as Snapshot).settings.installationPath, f.old);
    assert.deepEqual(await service.invoke('bootstrap.connect', { installationPath: 'C:\\attacker' }), { connected: true, alreadyConnected: false }); assert.equal((await service.invoke('snapshot') as Snapshot).settings.installationPath, f.target);
    assert.deepEqual(await service.invoke('bootstrap.connect'), { connected: true, alreadyConnected: true });
});
test('连接其他已安装环境前检查活动引擎和任务，保留当前环境与队列', async t => {
    const f = await fixture(t); f.engine.valid = true; const service = await f.create(); await assert.rejects(service.invoke('bootstrap.connect'), /停止现有引擎/); assert.equal((await service.invoke('snapshot') as Snapshot).settings.installationPath, f.old);
    await service.invoke('task.submit', { mode: 'text', templateId: 'h3-i2v', prompt: '镜头', width: 864, height: 480, frames: 124, steps: 4, seed: 0 }); f.engine.valid = false;
    await assert.rejects(service.invoke('bootstrap.connect'), /完成任务/); assert.equal((await service.invoke('snapshot') as Snapshot).settings.installationPath, f.old); assert.equal(f.engine.pending.length, 1); assert.ok(!f.engine.calls.includes('/interrupt'));
});
test('连接保存失败回退原设置，修复磁盘写入问题后可重试，不受上次rejected写链影响', async t => {
    const f = await fixture(t), service = await f.create(); const blocker = path.join(f.dataDir, 'studio.sqlite.tmp'); await fs.mkdir(blocker);
    await assert.rejects(service.invoke('bootstrap.connect'), /保存失败/); assert.equal((await service.invoke('snapshot') as Snapshot).settings.installationPath, f.old); await fs.rmdir(blocker);
    assert.deepEqual(await service.invoke('bootstrap.connect'), { connected: true, alreadyConnected: false }); assert.equal((await service.invoke('snapshot') as Snapshot).settings.installationPath, f.target);
});
test('安装完成后模型被清空，手动连接重新验证并拒绝切换，原环境不受影响', async t => {
    const f = await fixture(t), service = await f.create();
    const [folder, name] = h3ModelSpecs('lite')[0]; await fs.writeFile(path.join(f.target, 'ComfyUI/models', folder, name), '');
    await assert.rejects(service.invoke('bootstrap.connect'), /资源缺失或大小不符/); assert.equal((await service.invoke('snapshot') as Snapshot).settings.installationPath, f.old);
});
