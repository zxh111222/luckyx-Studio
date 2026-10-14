import { promises as fs } from 'node:fs';
import path from 'node:path';

const retryableCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);
const retryDelays = [250, 500, 1000, 1500, 2000];
export class EnvironmentPublishError extends Error {
    constructor(message: string) { super(message); this.name = 'EnvironmentPublishError'; }
}
export interface PublishEnvironmentOptions {
    signal: AbortSignal;
    rename?: typeof fs.rename;
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    onRetry?: (nextAttempt: number, totalAttempts: number) => void;
}
async function pause(milliseconds: number, signal: AbortSignal) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
async function validateAncestors(directory: string, signal: AbortSignal) {
    for (let current = directory;;) {
        signal.throwIfAborted();
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new EnvironmentPublishError('安装目录含目录链接或不是有效文件夹，已保留安装文件，请选择普通本地目录后检查');
        const parent = path.dirname(current);
        if (parent === current) return;
        current = parent;
    }
}
async function validateSourceTree(directory: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new EnvironmentPublishError('环境暂存目录含目录链接或不是文件夹，不能移动；已保留安装文件');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        signal.throwIfAborted();
        const child = path.join(directory, entry.name), childStat = await fs.lstat(child);
        if (childStat.isSymbolicLink()) throw new EnvironmentPublishError('环境暂存目录含文件或目录链接，不能移动；已保留安装文件');
        if (childStat.isDirectory()) await validateSourceTree(child, signal);
        else if (!childStat.isFile()) throw new EnvironmentPublishError('环境暂存目录包含无法识别的文件类型，不能移动；已保留安装文件');
    }
}
async function assertTargetAbsent(target: string) {
    try { await fs.lstat(target); }
    catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
    throw new EnvironmentPublishError('安装目标已出现，不会覆盖任何现有文件或目录；已保留下载和模型，请检查安装位置');
}

/** Finalize only the app's prepared directory; never copy a large model tree or remove a target. */
export async function publishEnvironmentDirectory(source: string, target: string, options: PublishEnvironmentOptions): Promise<void> {
    const resolvedSource = path.resolve(source), resolvedTarget = path.resolve(target);
    const root = path.dirname(resolvedTarget), relative = path.relative(root, resolvedSource);
    if (!path.isAbsolute(source) || !path.isAbsolute(target) || resolvedSource === resolvedTarget || !relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
        throw new EnvironmentPublishError('环境暂存目录必须位于所选安装位置内，不能跨目录移动；已保留安装文件');
    }
    const rename = options.rename ?? fs.rename;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        options.signal.throwIfAborted();
        try {
            // Revalidate for every attempt: a user-created destination or a changed
            // junction must stop the retry rather than be overwritten or followed.
            await validateAncestors(root, options.signal);
            await validateAncestors(path.dirname(resolvedSource), options.signal);
            await assertTargetAbsent(resolvedTarget);
            await validateSourceTree(resolvedSource, options.signal);
            await assertTargetAbsent(resolvedTarget);
            options.signal.throwIfAborted();
            await rename(resolvedSource, resolvedTarget);
            return;
        } catch (error: any) {
            options.signal.throwIfAborted();
            if (error instanceof EnvironmentPublishError) throw error;
            if (!retryableCodes.has(error.code)) throw new EnvironmentPublishError('无法完成环境目录配置，已保留下载文件和模型；请检查安装磁盘与目录权限后继续配置环境');
            if (attempt === retryDelays.length) throw new EnvironmentPublishError('环境文件夹暂时被程序占用，或当前目录没有移动权限。已自动重试并保留全部下载和模型；请关闭使用此目录的终端、资源管理器或 Python 程序，检查目录权限后继续配置环境');
            options.onRetry?.(attempt + 2, retryDelays.length + 1);
            await (options.wait ?? pause)(retryDelays[attempt], options.signal);
        }
    }
}
