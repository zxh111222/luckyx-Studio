import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { BootstrapFile } from '../shared/bootstrap';
import type { InstallableResourceCategory, InstallableResourceSummary, ResourceInstallProgress } from '../shared/resource-installation';
import { assertOfficialDownloadUrl, defaultRunner, validateArchiveListing, type BootstrapRunResult } from './bootstrap';
import { getPinnedH3Files, H3_COMMUNITY_NODES } from './h3-downloads';

interface CatalogEntry {
    id: string;
    category: InstallableResourceCategory;
    file: BootstrapFile;
}

function pinned(name: string): BootstrapFile {
    const file = getPinnedH3Files('standard').find(candidate => candidate.name === name);
    if (!file) throw new Error('固定资源清单不完整：' + name);
    return file;
}

const catalog: readonly CatalogEntry[] = [
    { id: 'h3-turbo-lora', category: 'lora', file: pinned('minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors') },
    { id: 'h3-clipproj-node', category: 'custom-node', file: H3_COMMUNITY_NODES.find(file => file.id === 'clipproj')! },
    { id: 'h3-spectrum-node', category: 'custom-node', file: H3_COMMUNITY_NODES.find(file => file.id === 'spectrum')! }
];

function entryFor(id: unknown): CatalogEntry {
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

async function download(entry: CatalogEntry, destination: string, fetcher: typeof globalThis.fetch, signal: AbortSignal, publish: (state: Partial<ResourceInstallProgress>) => void) {
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
    sevenZipPath: string;
    fetch?: typeof globalThis.fetch;
    runner?: (exe: string, args: string[], options: { signal: AbortSignal; cwd?: string }) => Promise<BootstrapRunResult>;
    onProgress?: (state: ResourceInstallProgress) => void;
}

export function createResourceInstaller(options: ResourceInstallerOptions) {
    const fetcher = options.fetch ?? globalThis.fetch, runner = options.runner ?? defaultRunner;
    const active = new Map<string, Promise<ResourceInstallProgress>>();

    async function installed(entry: CatalogEntry, root: string): Promise<boolean> {
        const target = path.join(root, entry.file.relativePath);
        if (entry.category !== 'custom-node') return hashMatches(target, entry.file);
        const stat = await regular(target);
        if (!stat?.isDirectory()) return false;
        const marker = await regular(path.join(target, '.luckyx-source.json'));
        if (!marker?.isFile() || marker.size > 65536) return false;
        let source: any;
        try { source = JSON.parse(await fs.readFile(path.join(target, '.luckyx-source.json'), 'utf8')); }
        catch { return false; }
        return source.app === 'luckyx. Studio' && source.sha256 === entry.file.sha256 && source.url === entry.file.url;
    }

    async function list(): Promise<InstallableResourceSummary[]> {
        const root = path.resolve(options.installationPath());
        await ensureSafeDirectory(root);
        return Promise.all(catalog.map(async entry => ({ id: entry.id, name: entry.file.name, category: entry.category, sizeBytes: entry.file.sizeBytes, status: await installed(entry, root) ? 'installed' as const : 'missing' as const })));
    }

    async function install(id: unknown, signal = new AbortController().signal): Promise<ResourceInstallProgress> {
        const entry = entryFor(id), existing = active.get(entry.id);
        if (existing) return existing;
        let state: ResourceInstallProgress = { id: entry.id, status: 'idle', receivedBytes: 0, totalBytes: entry.file.sizeBytes, message: '准备安装' };
        const publish = (patch: Partial<ResourceInstallProgress>) => { state = { ...state, ...patch }; options.onProgress?.({ ...state }); };
        const work = (async () => {
            try {
                const root = path.resolve(options.installationPath());
                await ensureSafeDirectory(root);
                if (await installed(entry, root)) { publish({ status: 'completed', receivedBytes: entry.file.sizeBytes, message: '资源已安装' }); return state; }
                const destination = path.join(root, entry.file.relativePath);
                if (entry.category !== 'custom-node') {
                    await ensureSafeDirectory(root, path.dirname(entry.file.relativePath));
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
                    await runner(options.sevenZipPath, ['x', archive, '-o' + extraction, '-y'], { signal });
                    const source = path.join(extraction, entry.file.archiveRoot!);
                    const init = await regular(path.join(source, '__init__.py'));
                    if (!init?.isFile() || !init.size) throw new Error('节点压缩包缺少入口文件');
                    await ensureSafeDirectory(root, path.dirname(entry.file.relativePath));
                    if (await lstat(destination)) throw new Error('目标位置已有其他节点，不会自动覆盖：' + entry.file.name);
                    await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
                    await fs.writeFile(path.join(destination, '.luckyx-source.json'), JSON.stringify({ app: 'luckyx. Studio', url: entry.file.url, sha256: entry.file.sha256 }), { flag: 'wx' });
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
