import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { BootstrapFile } from '../shared/bootstrap';
import type { InstallableResourceCategory, InstallableResourceSummary, ResourceInstallProgress } from '../shared/resource-installation';
import { assertOfficialDownloadUrl, defaultRunner, validateArchiveListing, type BootstrapRunResult } from './bootstrap';
import { getPinnedH3Files } from './h3-downloads';

export interface InstallableResourceCatalogEntry {
    id: string;
    category: InstallableResourceCategory;
    displayName: string;
    purpose: string;
    source: string;
    compatibility: string;
    file: BootstrapFile;
}

function categoryFor(file: BootstrapFile): InstallableResourceCategory {
    if (file.kind === 'node') return 'custom-node';
    const folder = path.dirname(file.relativePath).replaceAll('\\', '/').split('/').at(-1);
    const categories: Record<string, InstallableResourceCategory> = {
        diffusion_models: 'diffusion-model', text_encoders: 'text-encoder', vae: 'vae',
        loras: 'lora', clip_projections: 'clip-projection', model_patches: 'model-patch'
    };
    const category = categories[folder ?? ''];
    if (!category) throw new Error('固定资源目录没有对应类型：' + file.relativePath);
    return category;
}

const allPinnedH3Files = ['lite', 'lite-audio', 'balanced', 'standard']
    .flatMap(tier => getPinnedH3Files(tier as 'lite' | 'lite-audio' | 'balanced' | 'standard'))
    .filter((file, index, files) => files.findIndex(candidate => candidate.url === file.url && candidate.sha256 === file.sha256) === index);
export const PINNED_RESOURCE_CATALOG: readonly InstallableResourceCatalogEntry[] = allPinnedH3Files.map(file => ({
    id: file.name === 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors' ? 'h3-turbo-lora'
        : file.kind === 'node' ? `h3-${file.id}-node` : `h3-${categoryFor(file)}-${file.sha256.slice(0, 12)}`,
    category: categoryFor(file),
    displayName: file.kind === 'node' ? file.id === 'clipproj' ? 'H3 ClipProj 节点' : 'H3 Spectrum 加速节点'
        : file.name.replace(/\.safetensors$/i, ''),
    purpose: file.kind === 'node' ? 'MiniMax H3 Lite 工作流所需自定义节点'
        : categoryFor(file) === 'lora' ? 'MiniMax H3 官方四步加速 LoRA'
        : `MiniMax H3 ${categoryFor(file)}`,
    source: file.url.includes('/Comfy-Org/') ? 'Comfy 官方固定版本' : '社区固定版本',
    compatibility: file.kind === 'node' || /w4a8|qwen3vl_4b|ClipProj/i.test(file.name) ? 'MiniMax H3 Lite' : 'MiniMax H3 官方工作流',
    file
}));

function entryFor(catalog: readonly InstallableResourceCatalogEntry[], id: unknown): InstallableResourceCatalogEntry {
    if (typeof id !== 'string') throw new Error('请选择要安装的资源');
    const entry = catalog.find(candidate => candidate.id === id);
    if (!entry) throw new Error('资源不在 luckyx. Studio 固定清单中');
    return entry;
}

async function lstat(file: string) {
    try { return await fs.lstat(file); }
    catch (error: any) { if (error?.code === 'ENOENT') return undefined; throw error; }
}

async function regular(file: string) {
    const stat = await lstat(file);
    if (stat?.isSymbolicLink()) throw new Error('资源目录不能使用外部目录链接');
    return stat;
}

async function ensureSafeDirectory(root: string, relative = ''): Promise<string> {
    const absoluteRoot = path.resolve(root), target = path.resolve(absoluteRoot, relative);
    const rel = path.relative(absoluteRoot, target);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('资源路径超出 ComfyUI 安装目录');
    let current = absoluteRoot;
    const rootStat = await regular(current);
    if (!rootStat?.isDirectory()) throw new Error('ComfyUI 安装目录不存在');
    for (const segment of rel ? rel.split(path.sep) : []) {
        current = path.join(current, segment);
        const stat = await regular(current);
        if (!stat) await fs.mkdir(current);
        else if (!stat.isDirectory()) throw new Error('资源父路径不是目录');
    }
    return target;
}

async function assertComfyInstallation(root: string): Promise<void> {
    await ensureSafeDirectory(root);
    const main = await regular(path.join(root, 'ComfyUI', 'main.py'));
    if (!main?.isFile() || !main.size) throw new Error('当前目录不是可用的 ComfyUI 安装环境');
}

function modelRelativePath(entry: InstallableResourceCatalogEntry): string {
    const normalized = entry.file.relativePath.replaceAll('\\', '/');
    const prefix = 'ComfyUI/models/';
    if (!normalized.startsWith(prefix) || normalized.length === prefix.length) throw new Error('模型资源不在固定模型目录中');
    return normalized.slice(prefix.length);
}

function relativeTarget(entry: InstallableResourceCatalogEntry): string {
    return entry.category === 'custom-node' ? entry.file.relativePath.replaceAll('\\', '/') : modelRelativePath(entry);
}

async function resourceTarget(entry: InstallableResourceCatalogEntry, installationRoot: string, modelRoot: string): Promise<{ root: string; relative: string; target: string }> {
    const root = entry.category === 'custom-node' ? installationRoot : modelRoot;
    const relative = relativeTarget(entry);
    await ensureSafeDirectory(root);
    return { root, relative, target: path.join(root, relative) };
}

async function assertNoLinksTree(directory: string): Promise<void> {
    const stat = await regular(directory);
    if (!stat?.isDirectory()) throw new Error('解压结果不是目录');
    for (const item of await fs.readdir(directory)) {
        const child = path.join(directory, item), childStat = await regular(child);
        if (!childStat || (!childStat.isDirectory() && !childStat.isFile())) throw new Error('节点压缩包包含不支持的文件类型');
        if (childStat.isDirectory()) await assertNoLinksTree(child);
    }
}

async function hashMatches(file: string, expected: BootstrapFile, signal?: AbortSignal): Promise<boolean> {
    const stat = await regular(file);
    if (!stat) return false;
    if (!stat.isFile() || stat.size !== expected.sizeBytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) { signal?.throwIfAborted(); hash.update(chunk as Buffer); }
    return hash.digest('hex') === expected.sha256;
}

async function request(fetcher: typeof globalThis.fetch, initialUrl: string, init: RequestInit): Promise<Response> {
    let url = initialUrl;
    for (let redirect = 0; redirect < 6; redirect++) {
        assertOfficialDownloadUrl(url);
        const response = await fetcher(url, { ...init, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('下载来源重定向无效');
        url = new URL(location, url).href;
    }
    throw new Error('下载来源重定向次数过多');
}

async function download(entry: InstallableResourceCatalogEntry, destination: string, fetcher: typeof globalThis.fetch, signal: AbortSignal, publish: (state: Partial<ResourceInstallProgress>) => void) {
    if (await hashMatches(destination, entry.file, signal)) return;
    if (await lstat(destination)) throw new Error('目标位置已有不同文件，不会自动覆盖：' + entry.file.name);
    const partial = destination + '.part';
    let offset = 0;
    const partialStat = await regular(partial);
    if (partialStat && !partialStat.isFile()) throw new Error('下载暂存路径不是文件');
    if (partialStat) offset = partialStat.size;
    if (offset > entry.file.sizeBytes) { await fs.truncate(partial, 0); offset = 0; }
    const response = await request(fetcher, entry.file.url, { headers: { 'Accept-Encoding': 'identity', ...(offset ? { Range: `bytes=${offset}-` } : {}) }, signal });
    if (!response.ok || !response.body || ![200, 206].includes(response.status)) throw new Error(`资源下载失败（HTTP ${response.status}）`);
    if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
        if (!range || Number(range[1]) !== offset || Number(range[3]) !== entry.file.sizeBytes) throw new Error('断点下载响应与固定清单不符');
    } else offset = 0;
    const expected = entry.file.sizeBytes - offset;
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expected)) throw new Error('下载文件大小与固定清单不符');
    const handle = await fs.open(partial, offset ? 'a' : 'w');
    const reader = response.body.getReader();
    try {
        publish({ status: 'downloading', receivedBytes: offset, message: '正在下载 ' + entry.file.name });
        while (true) {
            signal.throwIfAborted();
            const result = await reader.read();
            if (result.done) break;
            if (offset + result.value.length > entry.file.sizeBytes) throw new Error('下载内容超过固定清单大小');
            let written = 0;
            while (written < result.value.length) {
                const resultWrite = await handle.write(result.value.subarray(written));
                if (resultWrite.bytesWritten <= 0) throw new Error('磁盘写入失败，请检查剩余空间');
                written += resultWrite.bytesWritten;
            }
            offset += result.value.length;
            publish({ receivedBytes: offset });
        }
    } finally { await handle.close(); await reader.cancel().catch(() => {}); }
    if (offset !== entry.file.sizeBytes) throw new Error('下载未完成，文件片段已保留');
    publish({ status: 'verifying', message: '正在校验 ' + entry.file.name });
    if (!await hashMatches(partial, entry.file, signal)) throw new Error('SHA256 完整性校验失败');
    await fs.rename(partial, destination);
}

export interface ResourceInstallerOptions {
    installationPath: () => string;
    modelPath: () => string;
    sevenZipPath: string;
    fetch?: typeof globalThis.fetch;
    runner?: (exe: string, args: string[], options: { signal: AbortSignal; cwd?: string }) => Promise<BootstrapRunResult>;
    onProgress?: (state: ResourceInstallProgress) => void;
    catalog?: readonly InstallableResourceCatalogEntry[];
}

export function createResourceInstaller(options: ResourceInstallerOptions) {
    const fetcher = options.fetch ?? globalThis.fetch, runner = options.runner ?? defaultRunner;
    const catalog = options.catalog ?? PINNED_RESOURCE_CATALOG;
    if (new Set(catalog.map(entry => entry.id)).size !== catalog.length) throw new Error('资源清单包含重复 ID');
    const active = new Map<string, Promise<ResourceInstallProgress>>();

    async function installed(entry: InstallableResourceCatalogEntry, installationRoot: string, modelRoot: string): Promise<boolean> {
        const { target } = await resourceTarget(entry, installationRoot, modelRoot);
        if (entry.category !== 'custom-node') return hashMatches(target, entry.file);
        const stat = await regular(target);
        if (!stat?.isDirectory()) return false;
        const init = await regular(path.join(target, '__init__.py'));
        if (!init?.isFile() || !init.size) return false;
        const marker = await regular(path.join(target, '.luckyx-source.json'));
        if (!marker?.isFile() || marker.size > 65536) return false;
        let source: any;
        try { source = JSON.parse(await fs.readFile(path.join(target, '.luckyx-source.json'), 'utf8')); }
        catch { return false; }
        return source.app === 'luckyx. Studio' && source.sha256 === entry.file.sha256 && source.url === entry.file.url;
    }

    async function list(): Promise<InstallableResourceSummary[]> {
        const installationRoot = path.resolve(options.installationPath()), modelRoot = path.resolve(options.modelPath());
        await assertComfyInstallation(installationRoot);
        await ensureSafeDirectory(modelRoot);
        return Promise.all(catalog.map(async entry => ({
            id: entry.id, name: entry.file.name, displayName: entry.displayName, category: entry.category,
            relativeTarget: relativeTarget(entry), purpose: entry.purpose, source: entry.source,
            compatibility: entry.compatibility, sizeBytes: entry.file.sizeBytes,
            status: await installed(entry, installationRoot, modelRoot) ? 'installed' as const : 'missing' as const
        })));
    }

    async function install(id: unknown, signal = new AbortController().signal): Promise<ResourceInstallProgress> {
        const entry = entryFor(catalog, id), existing = active.get(entry.id);
        if (existing) return existing;
        let state: ResourceInstallProgress = { id: entry.id, status: 'idle', receivedBytes: 0, totalBytes: entry.file.sizeBytes, message: '准备安装' };
        const publish = (patch: Partial<ResourceInstallProgress>) => { state = { ...state, ...patch }; options.onProgress?.({ ...state }); };
        const work = (async () => {
            try {
                const root = path.resolve(options.installationPath()), modelRoot = path.resolve(options.modelPath());
                await assertComfyInstallation(root);
                await ensureSafeDirectory(modelRoot);
                if (await installed(entry, root, modelRoot)) { publish({ status: 'completed', receivedBytes: entry.file.sizeBytes, message: '资源已安装' }); return state; }
                const resource = await resourceTarget(entry, root, modelRoot), destination = resource.target;
                if (entry.category !== 'custom-node') {
                    await ensureSafeDirectory(resource.root, path.dirname(resource.relative));
                    await download(entry, destination, fetcher, signal, publish);
                } else {
                    const cache = await ensureSafeDirectory(root, '.luckyx-resources/nodes');
                    const archive = path.join(cache, entry.file.name);
                    await download(entry, archive, fetcher, signal, publish);
                    publish({ status: 'extracting', message: '正在安全解压 ' + entry.file.name });
                    const listing = await runner(options.sevenZipPath, ['l', '-slt', archive], { signal });
                    validateArchiveListing(listing.stdout);
                    const lines = (listing.stdout.includes('----------') ? listing.stdout.slice(listing.stdout.indexOf('----------') + 10) : listing.stdout).split(/\r?\n/).filter(line => line.startsWith('Path = '));
                    for (const line of lines) {
                        const item = line.slice(7).replaceAll('\\', '/');
                        if (item !== entry.file.archiveRoot && !item.startsWith(entry.file.archiveRoot + '/')) throw new Error('节点压缩包包含固定目录之外的内容');
                    }
                    const extraction = await ensureSafeDirectory(root, '.luckyx-resources/unpacked-' + entry.file.id + '-' + randomUUID());
                    try {
                        await runner(options.sevenZipPath, ['x', archive, '-o' + extraction, '-y'], { signal });
                        await assertNoLinksTree(extraction);
                        const source = path.join(extraction, entry.file.archiveRoot!);
                        const init = await regular(path.join(source, '__init__.py'));
                        if (!init?.isFile() || !init.size) throw new Error('节点压缩包缺少入口文件');
                        await ensureSafeDirectory(root, path.dirname(entry.file.relativePath));
                        if (await lstat(destination)) throw new Error('目标位置已有其他节点，不会自动覆盖：' + entry.file.name);
                        await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
                        await assertNoLinksTree(destination);
                        await fs.writeFile(path.join(destination, '.luckyx-source.json'), JSON.stringify({ app: 'luckyx. Studio', url: entry.file.url, sha256: entry.file.sha256 }), { flag: 'wx' });
                    } finally {
                        const cacheRoot = path.resolve(root, '.luckyx-resources'), resolved = path.resolve(extraction);
                        if (path.dirname(resolved) !== cacheRoot || !path.basename(resolved).startsWith('unpacked-' + entry.file.id + '-')) throw new Error('临时解压目录超出资源缓存');
                        await fs.rm(resolved, { recursive: true, force: true });
                    }
                }
                publish({ status: 'completed', receivedBytes: entry.file.sizeBytes, message: '安装完成：' + entry.file.name });
                return state;
            } catch (error) {
                if (signal.aborted) publish({ status: 'cancelled', message: '安装已暂停，下载片段会保留' });
                else publish({ status: 'error', message: '安装未完成', error: error instanceof Error ? error.message : '资源安装失败' });
                return state;
            }
        })().finally(() => active.delete(entry.id));
        active.set(entry.id, work);
        return work;
    }

    return { list, install };
}
