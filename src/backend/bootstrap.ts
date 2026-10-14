import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { BootstrapFile, BootstrapHardware, BootstrapPlan, BootstrapState, H3InstallationProfile } from '../shared/bootstrap';
import { recommendH3Installation, h3TierDefaults, h3TierLaunchArgs, H3_LITE_NODES } from '../shared/h3-installation';
import { getPinnedH3Files, isPinnedCommunityDownload } from './h3-downloads';
import { selectCudaRuntime } from '../shared/cuda-runtime';
import { getPinnedEnvironmentFile, environmentCachePaths, CUDA_GPU_PROBE_SCRIPT, validateGpuProbe } from './cuda-runtime';
import { publishEnvironmentDirectory, EnvironmentPublishError } from './publish-environment';
const GiB = 1024 ** 3;
const tutorialUrl = 'https://docs.comfy.org/installation/manual_install';
const downloadAttempts = 4;
class DownloadConnectionError extends Error {
    constructor(message: string, readonly retryAfterMs = 0) { super(message); }
}
function retryPause(delayMs: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
export interface BootstrapRunResult {
    stdout: string;
}
export interface BootstrapOptions {
    dataDir: string;
    sevenZipPath: string;
    fetch?: typeof globalThis.fetch;
    runner?: (exe: string, args: string[], options: {
        signal: AbortSignal;
        cwd?: string;
    }) => Promise<BootstrapRunResult>;
    getFreeBytes?: (directory: string) => Promise<number>;
    getModelFiles?: typeof getPinnedH3Files;
    getHardware?: () => Promise<BootstrapHardware>;
    getEnvironmentFile?: typeof getPinnedEnvironmentFile;
    renameEnvironmentDirectory?: typeof fs.rename;
}
export function assertOfficialDownloadUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('下载地址无效');
    }
    const host = url.hostname;
    const allowed = ['github.com', 'codeload.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs.hf.co', 'cdn-lfs-us-1.hf.co', 'cdn-lfs-eu-1.hf.co', 'us.aws.cdn.hf.co', 'eu.aws.cdn.hf.co', 'cas-bridge.xethub.hf.co', 'cas-server.xethub.hf.co'];
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed.includes(host))
        throw new Error('仅允许官方 HTTPS 下载来源');
    if (host === 'github.com' && !url.pathname.startsWith('/Comfy-Org/ComfyUI/releases/download/'))
        throw new Error('环境包须来自 ComfyUI 官方发布页');
    if (host === 'huggingface.co' && !url.pathname.startsWith('/Comfy-Org/MiniMax-H3/resolve/') && !isPinnedCommunityDownload(url))
        throw new Error('模型须来自官方仓库或固定版本的 H3 Lite 来源');
    if (host === 'codeload.github.com' && !isPinnedCommunityDownload(url))
        throw new Error('社区节点须来自已核对的固定源码版本');
    return url.href;
}
export function validateArchiveListing(listing: string): void {
    const entries = listing.includes('----------') ? listing.slice(listing.indexOf('----------') + 10) : listing;
    let count = 0;
    for (const line of entries.split(/\r?\n/)) {
        if (/^(Symbolic Link|Hard Link) = .+/.test(line))
            throw new Error('环境压缩包含外部文件链接，不能自动解压');
        if (!line.startsWith('Path = '))
            continue;
        const value = line.slice(7);
        count++;
        if (!value || /^[\\/]|[:\x00]/.test(value) || value.split(/[\\/]/).some(segment => segment === '..'))
            throw new Error('环境压缩包包含不安全的文件路径');
    }
    if (!count)
        throw new Error('无法核对环境压缩包文件清单');
}
async function exists(file: string) { try {
    await fs.lstat(file);
    return true;
}
catch (error: any) {
    if (error.code === 'ENOENT')
        return false;
    throw error;
} }
async function assertNoLinksTree(directory: string): Promise<void> { await noLinks(directory); for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const stat = await noLinks(file);
    if (stat.isDirectory())
        await assertNoLinksTree(file);
} }
async function noLinks(file: string) { const stat = await fs.lstat(file); if (stat.isSymbolicLink())
    throw new Error('安装目录不能使用外部目录链接'); return stat; }
async function nearestExistingDirectory(directory: string): Promise<string> {
    let candidate = path.resolve(directory);
    while (!await exists(candidate)) {
        const parent = path.dirname(candidate);
        if (parent === candidate) throw new Error('安装磁盘不存在，请选择其他位置');
        candidate = parent;
    }
    if (!(await noLinks(candidate)).isDirectory()) throw new Error('安装位置不能覆盖已有文件');
    for (let current = candidate;;) {
        await noLinks(current);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return candidate;
}
async function validateResumeOwner(rootPath: string, targetPath: string, version: string): Promise<boolean> {
    const cache = path.join(rootPath, '.luckyx-bootstrap');
    if (!await exists(cache)) return false;
    if (!(await noLinks(cache)).isDirectory()) throw new Error('暂存路径不是目录，不能覆盖');
    const marker = path.join(cache, 'owner.json');
    if (!await exists(marker)) throw new Error('暂存目录缺少本应用标识，不能覆盖');
    const markerStat = await noLinks(marker);
    if (!markerStat.isFile() || markerStat.size > 65536) throw new Error('暂存目录缺少有效的本应用标识，不能覆盖');
    const owner = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (owner.app !== 'luckyx. Studio' || owner.target !== targetPath || owner.version !== version) throw new Error('暂存目录不属于本次安装，不能覆盖');
    return true;
}
async function ownedResumeBytes(rootPath: string, targetPath: string, version: string): Promise<number> {
    if (!await validateResumeOwner(rootPath, targetPath, version)) return 0;
    const cache = path.join(rootPath, '.luckyx-bootstrap');
    async function count(directory: string): Promise<number> {
        let bytes = 0;
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name), stat = await noLinks(file);
            bytes += stat.isDirectory() ? await count(file) : stat.isFile() ? stat.size : 0;
        }
        return bytes;
    }
    return count(cache);
}
/** Inspect only the requested path chain without walking Python or reading weight bytes. */
async function inspectOwnedPath(root: string, candidate: string) {
    const relative = path.relative(root, candidate);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('安装资源路径超出所属目录');
    const segments = relative ? relative.split(path.sep) : [];
    let current = root;
    try {
        let stat = await noLinks(current);
        for (const segment of segments) {
            if (!stat.isDirectory()) throw new Error('安装资源的父路径不是目录');
            current = path.join(current, segment);
            stat = await noLinks(current);
        }
        return stat;
    } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function downloadedPlanBytes(rootPath: string, targetPath: string, version: string, files: BootstrapFile[], quick = false): Promise<number> {
    if (quick) { if (!await validateResumeOwner(rootPath, targetPath, version)) return 0; }
    else await ownedResumeBytes(rootPath, targetPath, version);
    const cache = path.join(rootPath, '.luckyx-bootstrap');
    if (!await exists(cache)) return 0;
    const cachePaths = environmentCachePaths(files[0]);
    let bytes = 0;
    for (const file of files) {
        const destination = file.kind === 'environment' ? path.join(cache, cachePaths.archiveName) : file.kind === 'node' ? path.join(cache, 'nodes', file.name) : path.join(cache, cachePaths.extractedName, 'ComfyUI_windows_portable', file.relativePath);
        for (const candidate of [destination, destination + '.part']) {
            const stat = quick ? await inspectOwnedPath(cache, candidate) : await exists(candidate) ? await noLinks(candidate) : undefined;
            if (!stat) continue;
            if (stat.isFile()) bytes += Math.min(file.sizeBytes, stat.size);
            break;
        }
    }
    return bytes;
}
async function reusablePlanBytes(rootPath: string, targetPath: string, version: string, files: BootstrapFile[], quick = false): Promise<number> {
    let bytes = await downloadedPlanBytes(rootPath, targetPath, version, files, quick);
    if (quick) return bytes; // Startup gives a conservative estimate; start rechecks actual free space.
    const cache = path.join(rootPath, '.luckyx-bootstrap');
    if (!await exists(cache)) return bytes;
    const cachePaths = environmentCachePaths(files[0]);
    const extracted = path.join(cache, cachePaths.extractedName);
    async function environmentBytes(directory: string): Promise<number> {
        let size = 0;
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            const relative = path.relative(extracted, file).replaceAll('\\', '/');
            if (relative === 'ComfyUI_windows_portable/ComfyUI/models' || relative === 'ComfyUI_windows_portable/ComfyUI/custom_nodes') continue;
            const stat = await noLinks(file);
            size += stat.isDirectory() ? await environmentBytes(file) : stat.isFile() ? stat.size : 0;
        }
        return size;
    }
    if (await exists(extracted)) bytes += Math.min(files[0].sizeBytes * 4, await environmentBytes(extracted));
    return bytes;
}
async function hashFile(file: string, signal?: AbortSignal): Promise<string> { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(chunk);
} return hash.digest('hex'); }
async function matches(file: string, expected: BootstrapFile, signal?: AbortSignal) { try {
    const stat = await noLinks(file);
    return stat.isFile() && stat.size === expected.sizeBytes && await hashFile(file, signal) === expected.sha256;
}
catch (error: any) {
    if (signal?.aborted)
        throw error;
    return false;
} }
export async function getPortableLaunchPlan(installationPath: string): Promise<{
    python: string;
    args: string[];
    cwd: string;
}> {
    for (const directory of [installationPath, path.join(installationPath, 'python_embeded'), path.join(installationPath, 'ComfyUI')])
        await noLinks(directory);
    const python = path.join(installationPath, 'python_embeded/python.exe'), main = path.join(installationPath, 'ComfyUI/main.py');
    for (const file of [python, main]) {
        const stat = await noLinks(file);
        if (!stat.isFile() || stat.size <= 0)
            throw new Error('Portable 环境缺少启动文件：' + path.basename(file));
    }
    return { python, args: ['-s', main, '--windows-standalone-build'], cwd: installationPath };
}
export async function defaultRunner(exe: string, args: string[], options: {
    signal: AbortSignal;
    cwd?: string;
}, spawnProcess: typeof spawn = spawn): Promise<BootstrapRunResult> {
    return new Promise((resolve, reject) => {
        const child = spawnProcess(exe, args, { cwd: options.cwd, windowsHide: true, signal: options.signal });
        let stdout = '', stderr = '', failure: Error | undefined;
        child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 32 * 1024 * 1024) {
            failure ??= new Error('解压清单过大');
            child.kill();
        } });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
        child.on('error', error => { failure ??= error; });
        // exit precedes closed pipes and can leave the just-probed directory in
        // use on Windows. Wait for close before the next install step or rename.
        child.on('close', code => failure ? reject(failure) : code === 0 ? resolve({ stdout }) : reject(new Error('环境检查或解压失败，请查看官方教程（退出代码 ' + code + '）')));
    });
}
export function createBootstrapManager(options: BootstrapOptions) {
    const fetcher = options.fetch ?? globalThis.fetch, runner = options.runner ?? defaultRunner;
    let state: BootstrapState = { status: 'idle', phase: '准备安装', message: '先检查硬件、磁盘和官方资源', receivedBytes: 0, totalBytes: 0, completedFiles: 0, tutorialUrl };
    const listeners = new Set<(value: BootstrapState) => void>();
    let currentPlan: BootstrapPlan | undefined, controller: AbortController | undefined, active: Promise<BootstrapState> | undefined;
    let lastInput: { rootPath: string; profile: H3InstallationProfile; selection?: { tier: BootstrapPlan['recommendation']['tier']; runtimeId: 'cu130' | 'cu126' } } | undefined;
    let persistedStatus = '', writes = Promise.resolve(), restoring = true;
    const progressPath = path.join(options.dataDir, 'bootstrap-progress.json');
    function persistProgress(force = false) {
        if (restoring || !lastInput || (!force && persistedStatus === state.status)) return;
        persistedStatus = state.status;
        const record = JSON.stringify({ app: 'luckyx. Studio', schemaVersion: 1, ...lastInput, status: state.status });
        writes = writes.catch(() => {}).then(async () => { await fs.mkdir(options.dataDir, { recursive: true }); const temporary = progressPath + '.' + randomUUID() + '.tmp'; await fs.writeFile(temporary, record, { flag: 'wx' }); await fs.rename(temporary, progressPath); });
    }
    const publish = (patch: Partial<BootstrapState>) => { state = { ...state, ...patch }; persistProgress(); for (const listener of listeners) {
        try {
            listener(structuredClone(state));
        }
        catch { }
    } };
    async function metadata(url: string): Promise<any> { const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } }); if (!response.ok)
        throw new Error('官方资源清单暂时无法获取'); return response.json(); }
    async function plan(input: {
        rootPath: string;
        hardware: BootstrapHardware;
        profile?: H3InstallationProfile;
    }, allowInstalled = false): Promise<BootstrapPlan> {
        if (active)
            throw new Error('安装正在进行，请先取消');
        currentPlan = undefined;
        lastInput = { rootPath: input.rootPath, profile: input.profile ?? 'h3' };
        publish({ status: 'planning', phase: '安装条件检查', message: '检查官方资源与安装条件', error: undefined, installationPath: undefined, currentFile: undefined, receivedBytes: 0, totalBytes: 0, completedFiles: 0, plan: undefined, resumable: false });
        try {
            if (!path.isAbsolute(input.rootPath) || input.rootPath.includes('\0'))
                throw new Error('请选择有效的绝对安装目录');
            const diskDirectory = await nearestExistingDirectory(input.rootPath);
            const targetPath = path.join(input.rootPath, 'luckyx-environment');
            if (!allowInstalled && await exists(targetPath))
                throw new Error('目标环境目录已存在，请使用已有环境接入或选择其他目录');
            const profile = input.profile ?? 'h3';
            if (!['environment', 'h3', 'h3-lite-audio'].includes(profile))
                throw new Error('请选择环境或 H3 完整安装');
            let { recommendation, hardwareIssues } = recommendH3Installation(input.hardware, profile);
            const { runtime, hardwareIssues: runtimeIssues } = selectCudaRuntime(input.hardware);
            hardwareIssues = [...hardwareIssues, ...runtimeIssues];
            if (allowInstalled) {
                const pendingCheck = '已恢复上次选择的安装清单；当前设备是否适合，需要点击“检查配置与下载量”重新确认';
                recommendation.reason = pendingCheck;
                recommendation.warnings = ['保留上次选择的模型方案，尚未重新验证当前设备', ...recommendation.warnings.filter(value => !value.includes('按硬件估算') && !value.includes('CUDA 13 需要'))];
                runtime.compatibility = 'unknown';
                runtime.reason = pendingCheck;
                runtime.warnings = ['已恢复上次选择的运行包，当前驱动兼容性待重新检查'];
                hardwareIssues = [pendingCheck];
            }
            const environment = (options.getEnvironmentFile ?? getPinnedEnvironmentFile)(runtime.id);
            // Query the fixed official release; digest-less responses can never change the trusted package.
            if (!allowInstalled) try {
                const release = await metadata('https://api.github.com/repos/Comfy-Org/ComfyUI/releases/tags/v0.39.0');
                const asset = release.assets?.find((item: any) => item.name === environment.name);
                if (asset && /^sha256:[a-f0-9]{64}$/.test(asset.digest) && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.browser_download_url === environment.url) {
                    environment.sha256 = asset.digest.slice(7);
                    environment.sizeBytes = asset.size;
                }
            }
            catch { /* verified immutable release pin remains available */ }
            const freeBytes = options.getFreeBytes ? await options.getFreeBytes(diskDirectory) : await fs.statfs(diskDirectory).then(stat => Number(stat.bavail) * Number(stat.bsize));
            let files = [environment, ...(profile !== 'environment' ? (options.getModelFiles ?? getPinnedH3Files)(recommendation.tier) : [])];
            if (profile === 'h3' && !hardwareIssues.length && !allowInstalled) {
                const initialLabel = recommendation.label;
                for (const tier of recommendation.tier === 'standard' ? ['standard', 'balanced', 'lite'] as const : recommendation.tier === 'balanced' ? ['balanced', 'lite'] as const : ['lite'] as const) {
                    const candidate = [environment, ...(options.getModelFiles ?? getPinnedH3Files)(tier)];
                    const size = candidate.reduce((sum, file) => sum + file.sizeBytes, 0);
                    const required = Math.max(5 * GiB, size + environment.sizeBytes * 4 + 5 * GiB - await reusablePlanBytes(input.rootPath, targetPath, 'v0.39.0', candidate));
                    if (freeBytes >= required || tier === 'lite') {
                        files = candidate;
                        if (tier !== recommendation.tier) {
                            const adjustedHardware = tier === 'balanced' ? { ...input.hardware, vramMb: Math.min(input.hardware.vramMb, 23000) } : { ...input.hardware, vramMb: Math.min(input.hardware.vramMb, 12000) };
                            recommendation = recommendH3Installation(adjustedHardware, profile).recommendation;
                            recommendation.reason += `；当前磁盘空间不足以安装 ${initialLabel}，已选择下载量较小的方案`;
                        }
                        break;
                    }
                }
            }
            for (const file of files)
                assertOfficialDownloadUrl(file.url);
            for (const file of files) {
                if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0 || /[\x00:]/.test(file.relativePath) || /^[\\/]/.test(file.relativePath) || file.relativePath.split(/[\\/]/).some(segment => segment === '..')) throw new Error('安装文件清单无效');
            }
            const downloadBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
            const cachedBytes = await downloadedPlanBytes(input.rootPath, targetPath, 'v0.39.0', files, allowInstalled);
            const reusableBytes = allowInstalled ? cachedBytes : await reusablePlanBytes(input.rootPath, targetPath, 'v0.39.0', files);
            const requiredFreeBytes = Math.max(5 * GiB, downloadBytes + environment.sizeBytes * 4 + 5 * GiB - reusableBytes);
            currentPlan = { profile, id: randomUUID(), version: 'v0.39.0', rootPath: path.resolve(input.rootPath), targetPath, files, downloadBytes, cachedBytes, requiredFreeBytes, freeBytes, hardwareIssues, recommendation, runtime, tutorialUrl: ['lite', 'lite-audio'].includes(recommendation.tier) ? 'https://github.com/reventadirecta/MiniMax-H3-ComfyUI-8GB-VRAM' : tutorialUrl };
            lastInput!.selection = { tier: recommendation.tier, runtimeId: runtime.id };
            publish({ status: 'idle', message: hardwareIssues.length ? hardwareIssues.join('；') : profile !== 'environment' ? recommendation.label + '：按本机配置选择，首次生成仍需试跑' : '基础环境可安装；H3 模型不会下载', receivedBytes: cachedBytes, totalBytes: downloadBytes, tutorialUrl: currentPlan.tutorialUrl, plan: structuredClone(currentPlan), resumable: false });
            persistProgress(true);
            await writes;
            return structuredClone(currentPlan);
        }
        catch (error: any) {
            publish({ status: 'error', error: error.message, message: error.message });
            await writes;
            throw error;
        }
    }
    async function requestFile(url: string, init: RequestInit): Promise<Response> {
        for (let redirect = 0; redirect < 6; redirect++) {
            assertOfficialDownloadUrl(url);
            let response: Response;
            try { response = await fetcher(url, { ...init, redirect: 'manual' }); }
            catch { throw new DownloadConnectionError('连接下载来源失败'); }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                if (!location)
                    throw new Error('下载来源重定向无效');
                url = new URL(location, url).href;
                await response.body?.cancel();
                continue;
            }
            return response;
        }
        throw new Error('下载来源重定向次数过多');
    }
    async function download(file: BootstrapFile, destination: string, signal: AbortSignal) {
        publish({ status: 'verifying', currentFile: file.name, phase: '核对已有文件', message: '正在校验 ' + file.name });
        if (await matches(destination, file, signal)) {
            publish({ receivedBytes: state.receivedBytes + file.sizeBytes, completedFiles: state.completedFiles + 1 });
            return;
        }
        if (await exists(destination))
            throw new Error('已有下载文件完整性不符，请在管理安装目录中检查该文件：' + file.name);
        const partial = destination + '.part';
        await fs.mkdir(path.dirname(destination), { recursive: true });
        // A retry reuses only bytes actually written to this owned partial. The base
        // belongs to previous files, so resumed bytes can never be counted twice.
        const receivedBeforeFile = state.receivedBytes;
        const source = new URL(file.url).hostname === 'huggingface.co' ? 'Hugging Face' : 'GitHub';
        const downloadPhase = file.kind === 'environment' ? '下载运行环境' : file.kind === 'node' ? '下载 H3 节点' : '下载 H3 模型';
        for (let attempt = 1; attempt <= downloadAttempts; attempt++) {
            signal.throwIfAborted();
            let offset = 0;
            if (await exists(partial)) {
                const stat = await noLinks(partial);
                if (!stat.isFile()) throw new Error('下载暂存路径不是文件：' + file.name);
                offset = stat.size;
                if (offset > file.sizeBytes) { await fs.truncate(partial, 0); offset = 0; }
            }
            publish({ receivedBytes: receivedBeforeFile + offset });
            if (offset === file.sizeBytes) break;
            // Bound connection/header wait and idle reads, but never impose a total
            // timeout on multi-gigabyte downloads. Every retry gets fresh CDN links.
            const attemptController = new AbortController();
            const attemptSignal = AbortSignal.any([signal, attemptController.signal]);
            let timeout = setTimeout(() => attemptController.abort(), 30000);
            let response: Response | undefined;
            try {
                publish({ status: 'downloading', phase: downloadPhase, message: '正在连接 ' + source + '：' + file.name });
                response = await requestFile(file.url, { headers: { 'Accept-Encoding': 'identity', ...(offset ? { Range: `bytes=${offset}-` } : {}) }, signal: attemptSignal });
                clearTimeout(timeout);
                if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
                    const retryAfter = response.headers.get('retry-after') ?? '';
                    const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000);
                    throw new DownloadConnectionError(`下载来源暂时不可用（HTTP ${response.status}）`, Math.min(10000, Number.isFinite(seconds) ? seconds * 1000 : 0));
                }
                if (!response.ok || !response.body) throw new Error(`无法从 ${source} 下载 ${file.name}（HTTP ${response.status}）。请检查网络或系统代理后继续安装，已下载文件会保留`);
                if (response.status !== 200 && response.status !== 206) throw new Error('下载响应无效，已保留原片段：' + file.name);
                let expectedEnd = file.sizeBytes - 1;
                if (response.status === 206) {
                    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
                    if (!match || Number(match[1]) !== offset || Number(match[3]) !== file.sizeBytes || Number(match[2]) < offset || Number(match[2]) >= file.sizeBytes) throw new Error('断点响应无效，请稍后重试');
                    expectedEnd = Number(match[2]);
                } else offset = 0; // The source ignored Range; replace only this partial.
                const contentLength = response.headers.get('content-length');
                if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== expectedEnd + 1 - offset)) throw new Error('下载响应文件大小与清单不符，已保留原片段：' + file.name);
                const handle = await fs.open(partial, offset ? 'a' : 'w');
                const reader = response.body.getReader();
                const onAbort = () => { void reader.cancel().catch(() => {}); };
                attemptSignal.addEventListener('abort', onAbort, { once: true });
                publish({ status: 'downloading', phase: downloadPhase, message: '正在下载 ' + file.name, receivedBytes: receivedBeforeFile + offset });
                try {
                    while (true) {
                        signal.throwIfAborted();
                        timeout = setTimeout(() => attemptController.abort(), 60000);
                        let result: ReadableStreamReadResult<Uint8Array>;
                        try { result = await reader.read(); }
                        catch { throw new DownloadConnectionError('下载连接中断'); }
                        finally { clearTimeout(timeout); }
                        signal.throwIfAborted();
                        if (attemptSignal.aborted) throw new DownloadConnectionError('下载连接超时');
                        if (result.done) break;
                        if (offset + result.value.length > expectedEnd + 1) throw new Error('下载文件大小超出官方清单');
                        let written = 0;
                        while (written < result.value.length) {
                            signal.throwIfAborted();
                            const resultWrite = await handle.write(result.value.subarray(written));
                            if (resultWrite.bytesWritten <= 0) throw new Error('磁盘写入失败，请检查剩余空间');
                            written += resultWrite.bytesWritten;
                        }
                        offset += result.value.length;
                        publish({ receivedBytes: receivedBeforeFile + offset });
                    }
                } finally {
                    attemptSignal.removeEventListener('abort', onAbort);
                    await handle.close();
                    await reader.cancel().catch(() => {});
                }
                signal.throwIfAborted();
                if (offset < file.sizeBytes) throw new DownloadConnectionError('下载未传输完整');
                break;
            } catch (error) {
                signal.throwIfAborted();
                if (!(error instanceof DownloadConnectionError)) throw error;
                if (attempt === downloadAttempts) throw new Error(`暂时无法从 ${source} 完成下载：${file.name}。已自动重试 ${downloadAttempts - 1} 次，下载进度已保留；请检查网络或系统代理后继续安装`);
                if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
                clearTimeout(timeout);
                publish({ status: 'downloading', phase: '连接中断，自动重试', message: `${source} 连接中断，已保留进度；准备第 ${attempt} / ${downloadAttempts - 1} 次重试` });
                await retryPause(Math.max(1000 * 2 ** (attempt - 1), error.retryAfterMs), signal);
            } finally {
                clearTimeout(timeout);
                if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
                attemptController.abort();
            }
        }
        publish({ status: 'verifying', phase: 'SHA256 完整性校验', message: '正在校验 ' + file.name });
        if (!await matches(partial, file, signal)) {
            await fs.truncate(partial, 0);
            publish({ receivedBytes: receivedBeforeFile });
            throw new Error('SHA256 或文件大小校验失败，保留其他下载，下次重试此文件');
        }
        await fs.rename(partial, destination);
        publish({ completedFiles: state.completedFiles + 1 });
    }
    async function runInstall(value: BootstrapPlan): Promise<BootstrapState> {
        if (!currentPlan || value.id !== currentPlan.id)
            throw new Error('请先重新检查安装条件');
        const trusted = structuredClone(currentPlan);
        const signal = controller!.signal;
        publish({ status: 'verifying', receivedBytes: 0, completedFiles: 0, totalBytes: trusted.downloadBytes, error: undefined, phase: '安装前检查', currentFile: undefined, message: '检查硬件和磁盘空间' });
        try {
            const diskDirectory = await nearestExistingDirectory(trusted.rootPath);
            if (options.getHardware) {
                const actualHardware = await options.getHardware();
                const actualRuntime = selectCudaRuntime(actualHardware);
                const actualProfile = recommendH3Installation(actualHardware, trusted.profile);
                const issues = [...actualProfile.hardwareIssues, ...actualRuntime.hardwareIssues];
                if (issues.length) throw new Error(issues.join('；') + '；已保留下载进度，请处理后重新检查安装条件');
                if (!trusted.runtime || actualRuntime.runtime.id !== trusted.runtime.id) throw new Error('设备或驱动配置已变化，请重新检查安装条件；已下载的模型和文件会保留');
            }
            if (trusted.hardwareIssues.length)
                throw new Error(trusted.hardwareIssues.join('；'));
            if (await exists(trusted.targetPath))
                throw new Error('目标目录已存在，不会覆盖用户环境');
            const free = options.getFreeBytes ? await options.getFreeBytes(diskDirectory) : await fs.statfs(diskDirectory).then(stat => Number(stat.bavail) * Number(stat.bsize));
            const remainingBytes = Math.max(5 * GiB, trusted.downloadBytes + trusted.files[0].sizeBytes * 4 + 5 * GiB - await reusablePlanBytes(trusted.rootPath, trusted.targetPath, trusted.version, trusted.files));
            if (free < remainingBytes)
                throw new Error('磁盘空间不足，请选择空间更大的目录');
            await fs.mkdir(trusted.rootPath, { recursive: true });
            await noLinks(trusted.rootPath);
            const cache = path.join(trusted.rootPath, '.luckyx-bootstrap'), marker = path.join(cache, 'owner.json');
            if (await exists(cache)) {
                await noLinks(cache);
                await noLinks(marker);
                const owner = JSON.parse(await fs.readFile(marker, 'utf8'));
                if (owner.app !== 'luckyx. Studio' || owner.target !== trusted.targetPath || owner.version !== trusted.version)
                    throw new Error('暂存目录不属于本次安装，不能覆盖');
            }
            else {
                await fs.mkdir(cache);
                await fs.writeFile(marker, JSON.stringify({ app: 'luckyx. Studio', target: trusted.targetPath, version: trusted.version }), { flag: 'wx' });
            }
            const cachePaths = environmentCachePaths(trusted.files[0]);
            const archive = path.join(cache, cachePaths.archiveName), extracted = path.join(cache, cachePaths.extractedName);
            await download(trusted.files[0], archive, signal);
            publish({ status: 'extracting', phase: '解压官方运行环境', message: '下载已校验，正在安全解压' });
            const listing = await runner(options.sevenZipPath, ['l', '-slt', archive], { signal });
            validateArchiveListing(listing.stdout);
            await fs.mkdir(extracted, { recursive: true });
            await assertNoLinksTree(extracted);
            await runner(options.sevenZipPath, ['x', archive, '-o' + extracted, '-y', '-aoa'], { signal });
            await assertNoLinksTree(extracted);
            const portable = path.join(extracted, 'ComfyUI_windows_portable');
            const launch = await getPortableLaunchPlan(portable);
            async function probeGpuRuntime(final = false) {
                signal.throwIfAborted();
                if (!trusted.runtime) throw new Error('安装计划缺少运行环境信息，请重新检查');
                publish({ status: 'verifying', phase: final ? '安装后 GPU 运算复验' : '检查 Python 与 GPU 运算', currentFile: undefined, message: final ? '文件已校验，正在再次确认 Python 与显卡可执行 GPU 运算' : '先验证显卡驱动能运行实际 GPU 运算，检查通过后再继续安装模型' });
                let probe: BootstrapRunResult;
                try { probe = await runner(launch.python, ['-s', '-c', CUDA_GPU_PROBE_SCRIPT], { signal, cwd: portable }); }
                catch {
                    signal.throwIfAborted();
                    throw new Error('Python 或 GPU 运行检查失败。已保留安装文件和模型，请检查 NVIDIA 驱动后重新检查并继续安装');
                }
                validateGpuProbe(probe.stdout, trusted.runtime);
            }
            await probeGpuRuntime();
            for (const file of trusted.files.slice(1)) {
                signal.throwIfAborted();
                const destination = path.join(portable, file.relativePath);
                if (file.kind === 'node') {
                    if (!file.archiveRoot || !/^[A-Za-z0-9._-]+$/.test(file.archiveRoot)) throw new Error('节点压缩包清单无效');
                    const nodeArchive = path.join(cache, 'nodes', file.name);
                    await download(file, nodeArchive, signal);
                    const nodeListing = await runner(options.sevenZipPath, ['l', '-slt', nodeArchive], { signal });
                    validateArchiveListing(nodeListing.stdout);
                    const entries = nodeListing.stdout.includes('----------') ? nodeListing.stdout.slice(nodeListing.stdout.indexOf('----------') + 10) : nodeListing.stdout;
                    for (const line of entries.split(/\r?\n/).filter(line => line.startsWith('Path = '))) {
                        const entry = line.slice(7).replaceAll('\\', '/');
                        if (entry !== file.archiveRoot && !entry.startsWith(file.archiveRoot + '/')) throw new Error('节点压缩包包含清单外目录');
                    }
                    const nodeExtraction = path.join(cache, 'node-unpacked', file.id);
                    await fs.mkdir(nodeExtraction, { recursive: true });
                    await assertNoLinksTree(nodeExtraction);
                    await runner(options.sevenZipPath, ['x', nodeArchive, '-o' + nodeExtraction, '-y', '-aoa'], { signal });
                    await assertNoLinksTree(nodeExtraction);
                    const source = path.join(nodeExtraction, file.archiveRoot);
                    const entry = await noLinks(path.join(source, '__init__.py'));
                    if (!entry.isFile() || !entry.size) throw new Error('社区节点缺少入口文件');
                    await fs.mkdir(path.dirname(destination), { recursive: true });
                    await noLinks(path.join(portable, 'ComfyUI/custom_nodes'));
                    const nodeMarker = path.join(destination, '.luckyx-source.json');
                    if (await exists(destination)) {
                        await assertNoLinksTree(destination);
                        const existing = JSON.parse(await fs.readFile(nodeMarker, 'utf8').catch(() => '{}'));
                        if (existing.sha256 !== file.sha256) throw new Error('已有社区节点不会被覆盖：' + file.name);
                    } else {
                        await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
                        await fs.writeFile(nodeMarker, JSON.stringify({ app: 'luckyx. Studio', url: file.url, sha256: file.sha256 }), { flag: 'wx' });
                    }
                    continue;
                }
                const modelParent = path.dirname(destination);
                await fs.mkdir(modelParent, { recursive: true });
                for (const segment of ['ComfyUI', 'ComfyUI/models', path.dirname(file.relativePath)])
                    await noLinks(path.join(portable, segment));
                await download(file, destination, signal);
            }
            await probeGpuRuntime(true);
            signal.throwIfAborted();
            await fs.writeFile(path.join(portable, 'luckyx-managed.json'), JSON.stringify({ app: 'luckyx. Studio', version: trusted.version, runtimeId: trusted.runtime!.id, installationTier: trusted.recommendation.tier, defaults: trusted.recommendation.defaults, models: trusted.files.filter(file => file.kind === 'model').map(file => ({ name: file.name, sha256: file.sha256 })), nodes: trusted.files.filter(file => file.kind === 'node').map(file => ({ name: file.name, sha256: file.sha256, url: file.url })) }));
            publish({ status: 'verifying', phase: '完成环境配置', message: '下载和校验已完成，正在配置最终运行环境目录', currentFile: undefined });
            await publishEnvironmentDirectory(portable, trusted.targetPath, {
                signal, rename: options.renameEnvironmentDirectory,
                onRetry: (next, total) => publish({ phase: '完成环境配置', message: `环境目录暂时被占用，正在尝试第 ${next} / ${total} 次配置；已下载的模型会保留`, currentFile: undefined })
            });
            publish({ status: 'completed', phase: '安装完成', message: trusted.profile !== 'environment' ? '环境和模型完整性通过；请启动后检查节点并进行首次试跑' : '基础环境完整性通过；请启动检查节点，H3 模型未下载', installationPath: trusted.targetPath, receivedBytes: trusted.downloadBytes });
        }
        catch (error: any) {
            publish({ status: signal.aborted ? 'cancelled' : 'error', phase: signal.aborted ? '已取消安装' : error instanceof EnvironmentPublishError ? '文件已准备，目录配置未完成' : '安装未完成', message: signal.aborted ? '已保留下载进度，可重新检查后继续安装' : error.message, error: signal.aborted ? undefined : error.message, ...(error instanceof EnvironmentPublishError ? { currentFile: undefined } : {}), resumable: signal.aborted || !await exists(trusted.targetPath) });
        }
        return structuredClone(state);
    }
    const ready = (async () => {
        try {
            if (!await exists(progressPath)) return;
            const stat = await noLinks(progressPath);
            if (!stat.isFile() || stat.size > 65536) return;
            const saved = JSON.parse(await fs.readFile(progressPath, 'utf8'));
            if (saved.app !== 'luckyx. Studio' || saved.schemaVersion !== 1 || typeof saved.rootPath !== 'string' || !['environment', 'h3', 'h3-lite-audio'].includes(saved.profile)) return;
            if (!path.isAbsolute(saved.rootPath) || saved.rootPath.includes('\0')) throw new Error('安装记录中的目录无效');
            await nearestExistingDirectory(saved.rootPath);
            const targetPath = path.join(saved.rootPath, 'luckyx-environment'), cache = path.join(saved.rootPath, '.luckyx-bootstrap');
            const validTier = (value: unknown): value is BootstrapPlan['recommendation']['tier'] => ['environment', 'lite', 'lite-audio', 'balanced', 'standard'].includes(value as string);
            let selection = saved.selection && validTier(saved.selection.tier) && ['cu130', 'cu126'].includes(saved.selection.runtimeId) ? saved.selection as { tier: BootstrapPlan['recommendation']['tier']; runtimeId: 'cu130' | 'cu126' } : undefined;
            // Old records did not save selection. Recover only the fixed model tier
            // and runtime identifiers; never trust saved URLs, hashes, or drivers.
            if (!selection) {
                if (await exists(cache)) await validateResumeOwner(saved.rootPath, targetPath, 'v0.39.0');
                for (const runtimeId of ['cu130', 'cu126'] as const) {
                    const paths = environmentCachePaths((options.getEnvironmentFile ?? getPinnedEnvironmentFile)(runtimeId));
                    const roots = [targetPath, path.join(cache, paths.extractedName, 'ComfyUI_windows_portable')];
                    for (const root of roots) {
                        const markerPath = path.join(root, 'luckyx-managed.json');
                        const markerStat = await inspectOwnedPath(saved.rootPath, markerPath);
                        if (!markerStat?.isFile() || markerStat.size > 65536) continue;
                        const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
                        if (marker.app === 'luckyx. Studio' && marker.version === 'v0.39.0' && validTier(marker.installationTier)) { selection = { tier: marker.installationTier, runtimeId: marker.runtimeId === 'cu126' ? 'cu126' : 'cu130' }; break; }
                    }
                    if (selection) break;
                    const recoveryTiers = saved.profile === 'h3-lite-audio' ? ['lite-audio'] as const : saved.profile === 'h3' ? ['lite', 'balanced', 'standard'] as const : [];
                    for (const tier of recoveryTiers) {
                        const diffusion = (options.getModelFiles ?? getPinnedH3Files)(tier).find(file => file.kind === 'model');
                        if (!diffusion) continue;
                        const file = path.join(cache, paths.extractedName, 'ComfyUI_windows_portable', diffusion.relativePath);
                        const complete = await inspectOwnedPath(saved.rootPath, file), partial = await inspectOwnedPath(saved.rootPath, file + '.part');
                        if (complete?.isFile() || partial?.isFile()) { selection = { tier, runtimeId }; break; }
                    }
                    if (selection) break;
                }
            }
            selection ??= { tier: saved.profile === 'environment' ? 'environment' : 'lite', runtimeId: 'cu130' };
            // This placeholder determines a fixed manifest only; compatibility is
            // deliberately unknown until the user requests a fresh hardware check.
            const emptyH3 = saved.profile !== 'environment' && selection.tier === 'environment';
            const restoreHardware: BootstrapHardware = { gpuName: selection.runtimeId === 'cu126' ? 'NVIDIA GeForce GTX 1080' : 'NVIDIA GeForce RTX 3060', vramMb: emptyH3 ? 0 : selection.tier === 'standard' ? 32768 : selection.tier === 'balanced' ? 16384 : 8192, ramGb: emptyH3 ? 0 : selection.tier === 'standard' ? 64 : selection.tier === 'balanced' ? 32 : 16, driver: '未知' };
            const restored = await plan({ rootPath: saved.rootPath, profile: saved.profile, hardware: restoreHardware }, true);
            if (await exists(restored.targetPath)) {
                await noLinks(restored.targetPath);
                await getPortableLaunchPlan(restored.targetPath);
                const markerPath = path.join(restored.targetPath, 'luckyx-managed.json');
                const markerStat = await noLinks(markerPath);
                if (!markerStat.isFile() || markerStat.size > 65536) throw new Error('已有环境标识无效，请手动检查');
                const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
                if (marker.app !== 'luckyx. Studio' || marker.version !== restored.version) throw new Error('已有环境需要手动检查，不能自动覆盖');
                // Completed installations keep their original tier; changed hardware never silently replaces weights.
                const installedFiles = (options.getModelFiles ?? getPinnedH3Files)(marker.installationTier ?? 'standard');
                const installedTier = restored.profile === 'environment' ? 'environment' : ['lite', 'lite-audio', 'balanced', 'standard'].includes(marker.installationTier) ? marker.installationTier as BootstrapPlan['recommendation']['tier'] : 'standard';
                const lite = installedTier === 'lite' || installedTier === 'lite-audio';
                const recommendation = { ...restored.recommendation, tier: installedTier, label: installedTier === 'lite' ? 'H3 Lite 视频版 · W4A8 + 4B' : installedTier === 'lite-audio' ? 'H3 Lite 音画版 · 实验' : installedTier === 'balanced' ? 'H3 均衡 · 官方 W6A8' : installedTier === 'standard' ? 'H3 标准 · 官方 INT8' : 'ComfyUI 基础环境', source: lite ? 'community' as const : 'official' as const, reason: '已安装的配置会保留；硬件变化不会自动替换模型', modelNames: installedFiles.filter(file => file.kind === 'model').map(file => file.name), requiredNodes: lite ? [...H3_LITE_NODES] : [], defaults: h3TierDefaults(installedTier), launchArgs: h3TierLaunchArgs(installedTier) };
                recommendation.warnings = installedTier === 'lite' ? ['已安装社区 Lite 图，使用 ClipProj / Spectrum；当前方案仅视频，不含音频', '按硬件估算的试用配置，尚未在此电脑验证生成'] : installedTier === 'lite-audio' ? ['已安装社区 Lite 音画实验方案；启动后先用短片验证声音、显存和稳定性'] : installedTier === 'environment' ? [] : ['已保留原有官方音视频配置；启动后检查节点并进行首次试跑'];
                // Preserve an installed runtime just as we preserve its model tier.
                // Legacy completed installations predate runtimeId and used cu130.
                const installedRuntimeId = marker.runtimeId === 'cu126' ? 'cu126' : 'cu130';
                const installedEnvironment = installedRuntimeId === restored.runtime?.id ? restored.files[0] : (options.getEnvironmentFile ?? getPinnedEnvironmentFile)(installedRuntimeId);
                const runtimeChanged = installedRuntimeId !== restored.runtime?.id;
                const installedRuntime = { ...restored.runtime!, id: installedRuntimeId as 'cu130' | 'cu126', label: installedRuntimeId === 'cu126' ? 'CUDA 12.6 · 旧显卡基础环境' : 'CUDA 13.0 · RTX 运行环境', cudaVersion: installedRuntimeId === 'cu126' ? '12.6' as const : '13.0' as const, ...(runtimeChanged ? { compatibility: 'unknown' as const, reason: '保留已安装的运行环境；当前设备是否兼容需要启动后检查', warnings: [...restored.runtime!.warnings, '设备配置已变化，已有运行包不会自动替换；请检查实际 GPU 运算与节点依赖'] } : {}) };
                currentPlan = { ...restored, runtime: installedRuntime, recommendation, files: [installedEnvironment, ...installedFiles], downloadBytes: installedEnvironment.sizeBytes + installedFiles.reduce((sum, file) => sum + file.sizeBytes, 0) };
                let missing = 0;
                for (const file of installedFiles) {
                    try {
                        const destination = path.join(restored.targetPath, file.relativePath);
                        const item = await inspectOwnedPath(restored.targetPath, destination);
                        if (!item || (file.kind === 'model' ? !item.isFile() || item.size !== file.sizeBytes : !item.isDirectory())) { missing++; continue; }
                        if (file.kind === 'node') {
                            const entry = await inspectOwnedPath(restored.targetPath, path.join(destination, '__init__.py'));
                            const sourcePath = path.join(destination, '.luckyx-source.json');
                            const sourceStat = await inspectOwnedPath(restored.targetPath, sourcePath);
                            if (!entry?.isFile() || !entry.size || !sourceStat?.isFile() || sourceStat.size > 65536) { missing++; continue; }
                            const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
                            if (source.app !== 'luckyx. Studio' || source.sha256 !== file.sha256 || source.url !== file.url) missing++;
                        }
                    } catch { missing++; }
                }
                if (missing) publish({ status: 'error', phase: '环境已解压，资源不完整', message: `已有环境缺少或损坏 ${missing} 项资源，请在资源中心检查；原文件会保留`, installationPath: restored.targetPath, resumable: false, plan: structuredClone(currentPlan) });
                else publish({ status: 'completed', phase: '已安装，等待引擎连接', message: '已识别现有环境和模型位置，无需重新下载安装；启动后检查节点', installationPath: restored.targetPath, receivedBytes: currentPlan.downloadBytes, totalBytes: currentPlan.downloadBytes, completedFiles: currentPlan.files.length, resumable: false, plan: structuredClone(currentPlan) });
                return;
            }
            if (!await exists(cache)) return;
            await validateResumeOwner(restored.rootPath, restored.targetPath, restored.version);
            const cachePaths = environmentCachePaths(restored.files[0]);
            const receivedBytes = restored.cachedBytes ?? 0;
            const archiveStat = await inspectOwnedPath(cache, path.join(cache, cachePaths.archiveName));
            const archiveReady = archiveStat?.isFile() && archiveStat.size === restored.files[0].sizeBytes;
            const extracted = path.join(cache, cachePaths.extractedName, 'ComfyUI_windows_portable');
            const extractedStat = await inspectOwnedPath(cache, extracted);
            const wasExtracted = extractedStat?.isDirectory() && await getPortableLaunchPlan(extracted).then(() => true).catch(() => false);
            publish({ status: 'cancelled', phase: wasExtracted && receivedBytes >= restored.downloadBytes ? '文件已准备，等待环境配置' : wasExtracted ? '环境已解压，模型待完成' : archiveReady ? '环境包已下载，等待解压' : '下载已暂停，可继续', message: '已保留安装位置与下载文件，继续安装会重新校验。请点击“检查配置与下载量”重新检查当前设备与驱动', receivedBytes, resumable: true });
        } catch (error: any) { publish({ status: 'error', phase: '安装恢复检查', message: error.message ?? '无法恢复安装记录，请选择已有环境或重新检查', error: error.message, resumable: false }); }
        finally { restoring = false; }
    })();
    async function completedInstallation(): Promise<string> {
        await ready;
        if (state.status !== 'completed' || !currentPlan || state.installationPath !== currentPlan.targetPath) throw new Error('请先完成安装或恢复检查，再连接已安装环境');
        const target = currentPlan.targetPath;
        await getPortableLaunchPlan(target);
        const markerPath = path.join(target, 'luckyx-managed.json');
        const markerStat = await noLinks(markerPath);
        if (!markerStat.isFile() || markerStat.size > 65536) throw new Error('环境安装标识无效，请检查资源');
        const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
        if (marker.app !== 'luckyx. Studio' || marker.version !== currentPlan.version || marker.installationTier !== currentPlan.recommendation.tier) throw new Error('环境安装标识不匹配，请重新检查资源');
        for (const file of currentPlan.files.filter(file => file.kind !== 'environment')) {
            for (const segment of ['ComfyUI', file.kind === 'node' ? 'ComfyUI/custom_nodes' : 'ComfyUI/models', path.dirname(file.relativePath)]) await noLinks(path.join(target, segment));
            const item = await noLinks(path.join(target, file.relativePath));
            if (file.kind === 'model' ? !item.isFile() || item.size !== file.sizeBytes : !item.isDirectory()) throw new Error('安装资源缺失或大小不符：' + file.name);
            if (file.kind === 'node') {
                const entry = await noLinks(path.join(target, file.relativePath, '__init__.py'));
                const sourcePath = path.join(target, file.relativePath, '.luckyx-source.json');
                await noLinks(sourcePath);
                const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
                if (!entry.isFile() || !entry.size || source.app !== 'luckyx. Studio' || source.sha256 !== file.sha256) throw new Error('已安装节点标识不匹配：' + file.name);
            }
        }
        return target;
    }
    return { ready, completedInstallation, async plan(input: Parameters<typeof plan>[0]) { await ready; return plan(input); }, start(value: BootstrapPlan): Promise<BootstrapState> { if (active)
            return active; controller = new AbortController(); active = runInstall(value).finally(async () => { active = undefined; controller = undefined; await writes; }); return active; }, cancel() { controller?.abort(); return structuredClone(state); }, snapshot() { return structuredClone(state); }, subscribe(listener: (value: BootstrapState) => void) { listeners.add(listener); return () => listeners.delete(listener); }, async dispose() { controller?.abort(); await ready; await active; await writes; listeners.clear(); } };
}




