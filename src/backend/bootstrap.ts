import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { BootstrapFile, BootstrapHardware, BootstrapPlan, BootstrapState } from '../shared/bootstrap';
import { recommendH3Installation, h3TierDefaults, h3TierLaunchArgs, H3_LITE_NODES } from '../shared/h3-installation';
import { getPinnedH3Files, isPinnedCommunityDownload } from './h3-downloads';
const GiB = 1024 ** 3;
const tutorialUrl = 'https://docs.comfy.org/installation/manual_install';
const pinnedEnvironment: BootstrapFile = { id: 'comfyui-portable', name: 'ComfyUI_windows_portable_nvidia.7z', kind: 'environment', relativePath: 'portable.7z', url: 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.39.0/ComfyUI_windows_portable_nvidia.7z', sizeBytes: 2003629308, sha256: '3dca347842ed1c6c833105fafb1669284685a3e54df41578d5f94bcc898ae039' };
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
async function ownedResumeBytes(rootPath: string, targetPath: string, version: string): Promise<number> {
    const cache = path.join(rootPath, '.luckyx-bootstrap');
    if (!await exists(cache)) return 0;
    await noLinks(cache);
    const marker = path.join(cache, 'owner.json');
    if (!await exists(marker) || !(await noLinks(marker)).isFile()) throw new Error('暂存目录缺少本应用标识，不能覆盖');
    const owner = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (owner.app !== 'luckyx. Studio' || owner.target !== targetPath || owner.version !== version) throw new Error('暂存目录不属于本次安装，不能覆盖');
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
async function reusablePlanBytes(rootPath: string, targetPath: string, version: string, files: BootstrapFile[]): Promise<number> {
    await ownedResumeBytes(rootPath, targetPath, version);
    const cache = path.join(rootPath, '.luckyx-bootstrap');
    if (!await exists(cache)) return 0;
    let bytes = 0;
    for (const file of files) {
        const destination = file.kind === 'environment' ? path.join(cache, 'portable.7z') : file.kind === 'node' ? path.join(cache, 'nodes', file.name) : path.join(cache, 'unpacked/ComfyUI_windows_portable', file.relativePath);
        for (const candidate of [destination, destination + '.part']) {
            if (!await exists(candidate)) continue;
            const stat = await noLinks(candidate);
            if (stat.isFile()) bytes += Math.min(file.sizeBytes, stat.size);
            break;
        }
    }
    const extracted = path.join(cache, 'unpacked');
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
async function defaultRunner(exe: string, args: string[], options: {
    signal: AbortSignal;
    cwd?: string;
}): Promise<BootstrapRunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(exe, args, { cwd: options.cwd, windowsHide: true, signal: options.signal });
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 32 * 1024 * 1024) {
            child.kill();
            reject(new Error('解压清单过大'));
        } });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve({ stdout }) : reject(new Error('环境检查或解压失败，请查看官方教程（退出代码 ' + code + '）')));
    });
}
export function createBootstrapManager(options: BootstrapOptions) {
    const fetcher = options.fetch ?? globalThis.fetch, runner = options.runner ?? defaultRunner;
    let state: BootstrapState = { status: 'idle', phase: '准备安装', message: '先检查硬件、磁盘和官方资源', receivedBytes: 0, totalBytes: 0, completedFiles: 0, tutorialUrl };
    const listeners = new Set<(value: BootstrapState) => void>();
    let currentPlan: BootstrapPlan | undefined, controller: AbortController | undefined, active: Promise<BootstrapState> | undefined;
    let lastInput: { rootPath: string; profile: 'environment' | 'h3' } | undefined;
    let persistedStatus = '', writes = Promise.resolve();
    const progressPath = path.join(options.dataDir, 'bootstrap-progress.json');
    function persistProgress(force = false) {
        if (!lastInput || (!force && persistedStatus === state.status)) return;
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
        profile?: 'environment' | 'h3';
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
            if (profile !== 'environment' && profile !== 'h3')
                throw new Error('请选择环境或 H3 完整安装');
            let { recommendation, hardwareIssues } = recommendH3Installation(input.hardware, profile);
            const environment = structuredClone(pinnedEnvironment);
            // Query the fixed official release; digest-less responses can never change the trusted package.
            try {
                const release = await metadata('https://api.github.com/repos/Comfy-Org/ComfyUI/releases/tags/v0.39.0');
                const asset = release.assets?.find((item: any) => item.name === environment.name);
                if (asset && /^sha256:[a-f0-9]{64}$/.test(asset.digest) && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.browser_download_url === environment.url) {
                    environment.sha256 = asset.digest.slice(7);
                    environment.sizeBytes = asset.size;
                }
            }
            catch { /* verified immutable release pin remains available */ }
            const freeBytes = options.getFreeBytes ? await options.getFreeBytes(diskDirectory) : await fs.statfs(diskDirectory).then(stat => Number(stat.bavail) * Number(stat.bsize));
            let files = [environment, ...(profile === 'h3' ? (options.getModelFiles ?? getPinnedH3Files)(recommendation.tier) : [])];
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
            const requiredFreeBytes = Math.max(5 * GiB, downloadBytes + environment.sizeBytes * 4 + 5 * GiB - await reusablePlanBytes(input.rootPath, targetPath, 'v0.39.0', files));
            currentPlan = { profile, id: randomUUID(), version: 'v0.39.0', rootPath: path.resolve(input.rootPath), targetPath, files, downloadBytes, requiredFreeBytes, freeBytes, hardwareIssues, recommendation, tutorialUrl: recommendation.tier === 'lite' ? 'https://github.com/reventadirecta/MiniMax-H3-ComfyUI-8GB-VRAM' : tutorialUrl };
            publish({ status: 'idle', message: hardwareIssues.length ? hardwareIssues.join('；') : profile === 'h3' ? recommendation.label + '：按本机配置选择，首次生成仍需试跑' : '基础环境可安装；H3 模型不会下载', totalBytes: downloadBytes, tutorialUrl: currentPlan.tutorialUrl, plan: structuredClone(currentPlan), resumable: false });
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
            const response = await fetcher(url, { ...init, redirect: 'manual' });
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
        let offset = 0;
        if (await exists(partial)) {
            const stat = await noLinks(partial);
            offset = stat.size;
            if (offset > file.sizeBytes) {
                await fs.truncate(partial, 0);
                offset = 0;
            }
        }
        if (offset < file.sizeBytes) {
            const response = await requestFile(file.url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal });
            if (!response.ok || !response.body)
                throw new Error('下载失败，请检查网络后重试：' + file.name);
            if (offset && response.status === 206) {
                const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
                if (!match || Number(match[1]) !== offset || Number(match[3]) !== file.sizeBytes)
                    throw new Error('断点响应无效，请稍后重试');
            }
            else if (offset) {
                offset = 0;
            }
            const handle = await fs.open(partial, offset ? 'a' : 'w');
            const reader = response.body.getReader();
            const onAbort = () => { void reader.cancel().catch(() => { }); };
            signal.addEventListener('abort', onAbort, { once: true });
            publish({ status: 'downloading', phase: file.kind === 'environment' ? '下载运行环境' : '下载 H3 模型', message: '正在下载 ' + file.name, receivedBytes: state.receivedBytes + offset });
            try {
                while (true) {
                    signal.throwIfAborted();
                    const result = await reader.read();
                    if (result.done)
                        break;
                    if (offset + result.value.length > file.sizeBytes)
                        throw new Error('下载文件大小超出官方清单');
                    let written = 0;
                    while (written < result.value.length) {
                        const resultWrite = await handle.write(result.value.subarray(written));
                        if (resultWrite.bytesWritten <= 0)
                            throw new Error('磁盘写入失败，请检查剩余空间');
                        written += resultWrite.bytesWritten;
                    }
                    ;
                    offset += result.value.length;
                    publish({ receivedBytes: state.receivedBytes + result.value.length });
                }
            }
            finally {
                signal.removeEventListener('abort', onAbort);
                await handle.close();
                await reader.cancel().catch(() => { });
            }
            signal.throwIfAborted();
        }
        else
            publish({ receivedBytes: state.receivedBytes + offset });
        publish({ status: 'verifying', phase: 'SHA256 完整性校验', message: '正在校验 ' + file.name });
        if (!await matches(partial, file, signal)) {
            await fs.truncate(partial, 0);
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
        publish({ status: 'verifying', receivedBytes: 0, completedFiles: 0, totalBytes: trusted.downloadBytes, error: undefined, phase: '安装前检查', message: '检查硬件和磁盘空间' });
        try {
            const diskDirectory = await nearestExistingDirectory(trusted.rootPath);
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
            const archive = path.join(cache, 'portable.7z'), extracted = path.join(cache, 'unpacked');
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
            publish({ status: 'verifying', phase: '检查 Python 与 CUDA', message: '模型校验完成，检查 portable Python 和 GPU 依赖' });
            const probe = await runner(launch.python, ['-s', '-c', 'import json,torch; print(json.dumps({"cuda":torch.version.cuda,"available":torch.cuda.is_available()}))'], { signal, cwd: portable });
            const check = JSON.parse(probe.stdout.trim().split(/\r?\n/).at(-1) ?? '{}');
            if (!check.available || !String(check.cuda).startsWith('13.'))
                throw new Error('CUDA 13 环境检查未通过，请按官方教程检查显卡驱动');
            signal.throwIfAborted();
            await fs.writeFile(path.join(portable, 'luckyx-managed.json'), JSON.stringify({ app: 'luckyx. Studio', version: trusted.version, installationTier: trusted.recommendation.tier, defaults: trusted.recommendation.defaults, models: trusted.files.filter(file => file.kind === 'model').map(file => ({ name: file.name, sha256: file.sha256 })), nodes: trusted.files.filter(file => file.kind === 'node').map(file => ({ name: file.name, sha256: file.sha256, url: file.url })) }));
            if (await exists(trusted.targetPath))
                throw new Error('安装目标已出现，不会覆盖任何现有目录');
            await fs.rename(portable, trusted.targetPath);
            publish({ status: 'completed', phase: '安装完成', message: trusted.profile === 'h3' ? '环境和模型完整性通过；请启动后检查节点并进行首次试跑' : '基础环境完整性通过；请启动检查节点，H3 模型未下载', installationPath: trusted.targetPath, receivedBytes: trusted.downloadBytes });
        }
        catch (error: any) {
            publish({ status: signal.aborted ? 'cancelled' : 'error', phase: signal.aborted ? '已取消安装' : '安装未完成', message: signal.aborted ? '已保留下载进度，可重新检查后继续安装' : error.message, error: signal.aborted ? undefined : error.message, resumable: signal.aborted || !await exists(trusted.targetPath) });
        }
        return structuredClone(state);
    }
    const ready = (async () => {
        if (!options.getHardware) return;
        try {
            if (!await exists(progressPath)) return;
            const stat = await noLinks(progressPath);
            if (!stat.isFile() || stat.size > 65536) return;
            const saved = JSON.parse(await fs.readFile(progressPath, 'utf8'));
            if (saved.app !== 'luckyx. Studio' || saved.schemaVersion !== 1 || typeof saved.rootPath !== 'string' || !['environment', 'h3'].includes(saved.profile)) return;
            const restored = await plan({ rootPath: saved.rootPath, profile: saved.profile, hardware: await options.getHardware() }, true);
            if (await exists(restored.targetPath)) {
                await assertNoLinksTree(restored.targetPath);
                await getPortableLaunchPlan(restored.targetPath);
                const marker = JSON.parse(await fs.readFile(path.join(restored.targetPath, 'luckyx-managed.json'), 'utf8'));
                if (marker.app !== 'luckyx. Studio' || marker.version !== restored.version) throw new Error('已有环境需要手动检查，不能自动覆盖');
                // Completed installations keep their original tier; changed hardware never silently replaces weights.
                const installedFiles = (options.getModelFiles ?? getPinnedH3Files)(marker.installationTier ?? 'standard');
                const installedTier = restored.profile === 'environment' ? 'environment' : ['lite', 'balanced', 'standard'].includes(marker.installationTier) ? marker.installationTier as BootstrapPlan['recommendation']['tier'] : 'standard';
                const recommendation = { ...restored.recommendation, tier: installedTier, label: installedTier === 'lite' ? 'H3 Lite · W4A8 + 4B 编码器' : installedTier === 'balanced' ? 'H3 均衡 · 官方 W6A8' : installedTier === 'standard' ? 'H3 标准 · 官方 INT8' : 'ComfyUI 基础环境', source: installedTier === 'lite' ? 'community' as const : 'official' as const, reason: '已安装的配置会保留；硬件变化不会自动替换模型', modelNames: installedFiles.filter(file => file.kind === 'model').map(file => file.name), requiredNodes: installedTier === 'lite' ? [...H3_LITE_NODES] : [], defaults: h3TierDefaults(installedTier), launchArgs: h3TierLaunchArgs(installedTier) };
                recommendation.warnings = installedTier === 'lite' ? ['已安装社区 Lite 图，使用 ClipProj / Spectrum；当前方案仅视频，不含音频', '按硬件估算的试用配置，尚未在此电脑验证生成'] : installedTier === 'environment' ? [] : ['已保留原有官方音视频配置；启动后检查节点并进行首次试跑'];
                currentPlan = { ...restored, recommendation, files: [restored.files[0], ...installedFiles], downloadBytes: restored.files[0].sizeBytes + installedFiles.reduce((sum, file) => sum + file.sizeBytes, 0) };
                let missing = 0;
                for (const file of installedFiles) {
                    try {
                        const item = await noLinks(path.join(restored.targetPath, file.relativePath));
                        if (file.kind === 'model' ? !item.isFile() || item.size !== file.sizeBytes : !item.isDirectory()) missing++;
                    } catch { missing++; }
                }
                if (missing) publish({ status: 'error', phase: '环境已解压，资源不完整', message: `已有环境缺少或损坏 ${missing} 项资源，请在资源中心检查；原文件会保留`, installationPath: restored.targetPath, resumable: false, plan: structuredClone(currentPlan) });
                else publish({ status: 'completed', phase: '已安装，等待引擎连接', message: '已识别现有环境和模型位置，无需重新下载安装；启动后检查节点', installationPath: restored.targetPath, receivedBytes: currentPlan.downloadBytes, totalBytes: currentPlan.downloadBytes, completedFiles: currentPlan.files.length, resumable: false, plan: structuredClone(currentPlan) });
                return;
            }
            const cache = path.join(restored.rootPath, '.luckyx-bootstrap');
            if (!await exists(cache)) return;
            await ownedResumeBytes(restored.rootPath, restored.targetPath, restored.version);
            let receivedBytes = 0;
            for (const file of restored.files) {
                const downloadedPath = file.kind === 'environment' ? path.join(cache, 'portable.7z') : file.kind === 'node' ? path.join(cache, 'nodes', file.name) : path.join(cache, 'unpacked/ComfyUI_windows_portable', file.relativePath);
                for (const candidate of [downloadedPath, downloadedPath + '.part']) {
                    try { const item = await noLinks(candidate); if (item.isFile()) { receivedBytes += Math.min(file.sizeBytes, item.size); break; } } catch { }
                }
            }
            const archiveReady = await matches(path.join(cache, 'portable.7z'), restored.files[0]);
            const extracted = path.join(cache, 'unpacked/ComfyUI_windows_portable');
            const wasExtracted = await getPortableLaunchPlan(extracted).then(() => true).catch(() => false);
            publish({ status: 'cancelled', phase: wasExtracted ? '环境已解压，模型待完成' : archiveReady ? '环境包已下载，等待解压' : '下载已暂停，可继续', message: '已保留安装位置与下载进度，继续后校验并完成安装', receivedBytes, resumable: true });
        } catch (error: any) { publish({ status: 'error', phase: '安装恢复检查', message: error.message ?? '无法恢复安装记录，请选择已有环境或重新检查', error: error.message, resumable: false }); }
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




