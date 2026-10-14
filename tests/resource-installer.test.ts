import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResourceInstaller, type InstallableResourceCatalogEntry } from '../src/backend/resource-installer';

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const modelUrl = (name: string) => `https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/${'a'.repeat(40)}/${name}`;
const nodeUrl = 'https://codeload.github.com/nicolab28/ComfyUI-ClipProj/zip/c01ba8fb8f41b4f2094dbd0b185cdc238fb6134c';

async function temporary(t: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luckyx-resource-installer-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('luckyx-resource-installer-')); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
function resource(id: string, category: InstallableResourceCatalogEntry['category'], relativePath: string, body: Buffer, extra: Partial<InstallableResourceCatalogEntry['file']> = {}): InstallableResourceCatalogEntry {
  return { id, category, displayName: id, purpose: '测试资源', source: '固定测试来源', compatibility: '测试工作流', file: { id, name: path.basename(relativePath), kind: category === 'custom-node' ? 'node' : 'model', relativePath, url: category === 'custom-node' ? nodeUrl : modelUrl(path.basename(relativePath)), sizeBytes: body.length, sha256: hash(body), ...extra } };
}
async function fixture(t: any, catalog: readonly InstallableResourceCatalogEntry[], bodies: Map<string, Buffer>, listing = '') {
  const root = await temporary(t), modelRoot = path.join(root, 'ComfyUI/models'); await fs.mkdir(modelRoot, { recursive: true }); await fs.writeFile(path.join(root, 'ComfyUI/main.py'), '# comfy');
  const requests: Array<{ url: string; range: string | null }> = [];
  const installer = createResourceInstaller({ installationPath: () => root, modelPath: () => modelRoot, sevenZipPath: 'mock-7za.exe', catalog,
    fetch: (async (input: any, init?: RequestInit) => {
      const url = String(input), range = new Headers(init?.headers).get('range'); requests.push({ url, range });
      const complete = bodies.get(url) ?? Buffer.alloc(0), offset = range ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? -1) : 0;
      return new Response(Uint8Array.from(complete.subarray(offset)), offset ? { status: 206, headers: { 'content-range': `bytes ${offset}-${complete.length - 1}/${complete.length}`, 'content-length': String(complete.length - offset) } } : { headers: { 'content-length': String(complete.length) } });
    }) as typeof fetch,
    runner: async (_exe, args) => {
      if (args[0] === 'l') return { stdout: listing };
      const output = args.find(arg => arg.startsWith('-o'))!.slice(2), node = catalog.find(item => item.category === 'custom-node')!;
      await fs.mkdir(path.join(output, node.file.archiveRoot!), { recursive: true }); await fs.writeFile(path.join(output, node.file.archiveRoot!, '__init__.py'), '# node'); return { stdout: '' };
    }
  });
  return { root, installer, requests };
}

test('通用清单把扩散、编码器、VAE、LoRA和节点安装到固定ComfyUI目录', async t => {
  const bodies = new Map<string, Buffer>(), entries: InstallableResourceCatalogEntry[] = [];
  for (const [id, category, relative] of [
    ['diffusion', 'diffusion-model', 'ComfyUI/models/diffusion_models/diffusion.safetensors'],
    ['encoder', 'text-encoder', 'ComfyUI/models/text_encoders/encoder.safetensors'],
    ['vae', 'vae', 'ComfyUI/models/vae/video-vae.safetensors'],
    ['lora', 'lora', 'ComfyUI/models/loras/style.safetensors']
  ] as const) { const body = Buffer.from('verified-' + id); const entry = resource(id, category, relative, body); entries.push(entry); bodies.set(entry.file.url, body); }
  const nodeBody = Buffer.from('verified-node-archive'), node = resource('node', 'custom-node', 'ComfyUI/custom_nodes/TrustedNode', nodeBody, { name: 'TrustedNode.zip', archiveRoot: 'TrustedNode-fixed' }); entries.push(node); bodies.set(node.file.url, nodeBody);
  const f = await fixture(t, entries, bodies, '----------\nPath = TrustedNode-fixed\nPath = TrustedNode-fixed/__init__.py');
  assert.deepEqual(new Set((await f.installer.list()).map(item => item.category)), new Set(['diffusion-model', 'text-encoder', 'vae', 'lora', 'custom-node']));
  for (const entry of entries) { const result = await f.installer.install(entry.id); assert.equal(result.status, 'completed', `${entry.id}: ${result.error}`); }
  for (const entry of entries.filter(item => item.category !== 'custom-node')) assert.equal(hash(await fs.readFile(path.join(f.root, entry.file.relativePath))), entry.file.sha256);
  assert.equal(await fs.readFile(path.join(f.root, node.file.relativePath, '__init__.py'), 'utf8'), '# node');
  assert.ok((await f.installer.list()).every(item => item.status === 'installed'));
});

test('安装接口只接受固定资源ID，路径穿越与已有用户文件均不会被覆盖', async t => {
  const body = Buffer.from('safe-lora'), lora = resource('safe', 'lora', 'ComfyUI/models/loras/safe.safetensors', body), escape = resource('escape', 'lora', '../outside.safetensors', body);
  const f = await fixture(t, [lora, escape], new Map([[lora.file.url, body], [escape.file.url, body]]));
  await assert.rejects(f.installer.install({ id: 'safe', url: lora.file.url } as any), /选择|固定清单/);
  await assert.rejects(f.installer.install('unknown'), /固定清单/);
  assert.equal((await f.installer.install('escape')).status, 'error'); await assert.rejects(fs.stat(path.join(path.dirname(f.root), 'outside.safetensors')), { code: 'ENOENT' });
  const target = path.join(f.root, lora.file.relativePath); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'user-file');
  const collision = await f.installer.install('safe'); assert.equal(collision.status, 'error'); assert.match(collision.error!, /不会自动覆盖/); assert.equal(await fs.readFile(target, 'utf8'), 'user-file');
});

test('模型断流保留part并按Range继续；大小或SHA错误绝不发布目标文件', async t => {
  const expected = Buffer.from('complete-lora'), entry = resource('resume', 'lora', 'ComfyUI/models/loras/resume.safetensors', expected);
  const root = await temporary(t), modelRoot = path.join(root, 'ComfyUI/models'); await fs.mkdir(modelRoot, { recursive: true }); await fs.writeFile(path.join(root, 'ComfyUI/main.py'), '# comfy'); let attempt = 0; const ranges: Array<string | null> = [];
  const installer = createResourceInstaller({ installationPath: () => root, modelPath: () => modelRoot, sevenZipPath: 'mock', catalog: [entry], fetch: (async (_input: any, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range'); ranges.push(range);
    if (++attempt === 1) return new Response(Uint8Array.from(expected.subarray(0, 4)));
    return new Response(Uint8Array.from(expected.subarray(4)), { status: 206, headers: { 'content-range': `bytes 4-${expected.length - 1}/${expected.length}`, 'content-length': String(expected.length - 4) } });
  }) as typeof fetch });
  assert.equal((await installer.install('resume')).status, 'error'); assert.equal((await fs.stat(path.join(root, entry.file.relativePath + '.part'))).size, 4);
  const resumed = await installer.install('resume'); assert.equal(resumed.status, 'completed', resumed.error); assert.deepEqual(ranges, [null, 'bytes=4-']); assert.equal(hash(await fs.readFile(path.join(root, entry.file.relativePath))), entry.file.sha256);
  const wrong = resource('wrong', 'lora', 'ComfyUI/models/loras/wrong.safetensors', Buffer.from('right-value')), wrongBytes = Buffer.from('wrong-value');
  const bad = await fixture(t, [wrong], new Map([[wrong.file.url, wrongBytes]])); const failed = await bad.installer.install('wrong'); assert.equal(failed.status, 'error'); assert.match(failed.error!, /SHA256/); await assert.rejects(fs.stat(path.join(bad.root, wrong.file.relativePath)), { code: 'ENOENT' });
});

test('自定义节点拒绝越界或链接压缩清单，可信节点用来源标识跨重启识别', async t => {
  const body = Buffer.from('node-zip'), node = resource('node', 'custom-node', 'ComfyUI/custom_nodes/TrustedNode', body, { name: 'TrustedNode.zip', archiveRoot: 'TrustedNode-fixed' });
  for (const listing of ['Path = ../escape.py', 'Path = C:\\escape.py', 'Path = TrustedNode-fixed/link\nSymbolic Link = outside']) {
    const bad = await fixture(t, [node], new Map([[node.file.url, body]]), listing); const state = await bad.installer.install('node'); assert.equal(state.status, 'error'); await assert.rejects(fs.stat(path.join(bad.root, node.file.relativePath)), { code: 'ENOENT' });
  }
  const good = await fixture(t, [node], new Map([[node.file.url, body]]), '----------\nPath = TrustedNode-fixed\nPath = TrustedNode-fixed/__init__.py');
  const installed = await good.installer.install('node'); assert.equal(installed.status, 'completed', installed.error); assert.equal((await good.installer.list())[0].status, 'installed');
  const reopened = createResourceInstaller({ installationPath: () => good.root, modelPath: () => path.join(good.root, 'ComfyUI/models'), sevenZipPath: 'unused', catalog: [node] }); assert.equal((await reopened.list())[0].status, 'installed');
  await fs.writeFile(path.join(good.root, node.file.relativePath, '.luckyx-source.json'), '{}'); assert.equal((await reopened.list())[0].status, 'missing');
});
