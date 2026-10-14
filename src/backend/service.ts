import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import type { Snapshot, StudioService, TaskRecord, Settings, GenerationParams, UserWorkflow, UserWorkflowDocument, VideoRecipeEntry } from '../shared/contracts';
import { validateEngineUrl, validateGenerationParams, validateImage, buildWorkflow, mapHistoryOutputs, isPromptRunning, safeOutputPath } from '../shared/workflow';
import { parseWorkflowJson, validateWorkflowName, createEmptyWorkflowJson } from '../shared/workflow-library';
import { analyzeWorkflowParameters, applyWorkflowParameterValues } from '../shared/workflow-parameters';
import { videoRecipeDefinitions, MODEL_LOADER_FIELDS } from '../shared/video-recipes';
import { getEngineInstallation } from './engine-installation';
import { createBootstrapManager } from './bootstrap';
import type { BootstrapPlan } from '../shared/bootstrap';
import { canRemoveTask } from '../shared/task-policy';
import { H3_STANDARD_MODELS } from '../shared/h3-installation';
import { getH3Runtime } from './h3-runtime';
import { parseNvidiaCudaVersion } from '../shared/cuda-runtime';
import { createResourceInstaller } from './resource-installer';
import type { ResourceInstallProgress } from '../shared/resource-installation';
const MODEL_SPECS = H3_STANDARD_MODELS;
const activeStatuses = ['submitting', 'queued', 'running', 'unknown'];
export async function createStudioService(options: {
    dataDir: string;
    defaultInstallationPath?: string;
    defaultEngineUrl?: string;
    outputBaseUrl?: string;
    sevenZipPath?: string;
    bootstrapFetch?: typeof globalThis.fetch;
    hardwareProbe?: () => Promise<Snapshot['hardware']>;
    spawnEngine?: typeof spawn;
    terminateEngine?: (child: ChildProcess) => Promise<void>;
    bootstrapManager?: ReturnType<typeof createBootstrapManager>;
}): Promise<StudioService> {
    await fs.mkdir(options.dataDir, { recursive: true });
    const dbPath = path.join(options.dataDir, 'studio.sqlite');
    const require = createRequire(import.meta.url);
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    let bytes: Buffer | undefined;
    try {
        bytes = await fs.readFile(dbPath);
    }
    catch (e: any) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const db = new SQL.Database(bytes);
    db.run('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS user_workflows (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, json TEXT NOT NULL)');
    const installationPath = options.defaultInstallationPath ?? path.resolve(options.dataDir, 'environments/luckyx-environment');
    const snapshot: Snapshot = { settings: { installationPath, modelPath: path.join(installationPath, 'ComfyUI/models'), outputPath: path.join(options.dataDir, 'output'), inputPath: path.join(options.dataDir, 'input'), engineUrl: options.defaultEngineUrl ?? 'http://127.0.0.1:8188', initialized: false }, engine: { status: 'offline', managed: false, queue: 0, message: '尚未连接引擎' }, hardware: { gpuName: '检测中', vramMb: 0, ramGb: Math.round(os.totalmem() / 1024 ** 3), driver: '未知' }, templates: [{ id: 'h3-i2v', name: 'MiniMax H3 · 图生视频', description: '支持首帧或纯提示词，默认约 5.17 秒含音频视频', ready: false, issues: ['尚未验证运行节点'], models: MODEL_SPECS.map(x => x[1]), resolutions: [{ label: '864 × 480', width: 864, height: 480 }, { label: '832 × 480', width: 832, height: 480 }], defaultSteps: 4, frames: 124, fps: 24 }], tasks: [], resources: [], logs: [], presets: [], userWorkflows: [] };
    const rows = db.exec('SELECT key,value FROM state')[0]?.values ?? [];
    for (const [key, value] of rows) {
        if (['settings', 'tasks', 'presets'].includes(String(key))) {
            try {
                (snapshot as any)[String(key)] = JSON.parse(String(value));
            }
            catch { }
        }
    }
    const workflowRows = db.exec('SELECT metadata FROM user_workflows ORDER BY rowid DESC')[0]?.values ?? [];
    for (const [value] of workflowRows) {
        try {
            snapshot.userWorkflows.push(JSON.parse(String(value)) as UserWorkflow);
        }
        catch { }
    }
    snapshot.settings.engineUrl = validateEngineUrl(snapshot.settings.engineUrl);
    let h3Runtime = await getH3Runtime(snapshot.settings.installationPath, snapshot.settings.modelPath);
    const listeners = new Set<(s: Snapshot) => void>();
    let child: ChildProcess | undefined;
    let socket: WebSocket | undefined;
    let disposed = false;
    let closing = false, shutdownFlight: Promise<void> | undefined;
    const shutdownController = new AbortController();
    const bootstrap = options.bootstrapManager ?? createBootstrapManager({ dataDir: options.dataDir, fetch: options.bootstrapFetch, sevenZipPath: options.sevenZipPath ?? path.resolve('node_modules/7zip-bin/win/x64/7za.exe'), getHardware: async () => { await hardwareReady; await detectHardware(); return structuredClone(snapshot.hardware); } });
    let resourceProgress: ResourceInstallProgress | undefined;
    let resourceFlight: Promise<void> | undefined;
    let resourceController: AbortController | undefined;
    const resourceInstaller = createResourceInstaller({
        installationPath: () => snapshot.settings.installationPath,
        modelPath: () => snapshot.settings.modelPath,
        sevenZipPath: options.sevenZipPath ?? path.resolve('node_modules/7zip-bin/win/x64/7za.exe'),
        fetch: options.bootstrapFetch,
        onProgress: progress => { resourceProgress = progress; }
    });
    let bootstrapPlan: BootstrapPlan | undefined;
    let bootstrapFlight: Promise<void> | undefined;
    let bootstrapConnectionError: string | undefined;
    let refreshFlight: Promise<Snapshot> | undefined;
    let startBusy = false;
    let startFlight: Promise<unknown> | undefined;
    let submitChain = Promise.resolve();
    const inflightSubmissions = new Map<string, Promise<unknown>>();
    const clientId = randomUUID();
    let initialized = false;
    let initialization: Promise<void>;
    let initializationFailed = false;
    const emit = () => {
        if (initialized && !disposed && !closing)
            for (const listener of listeners) {
                try {
                    listener(structuredClone(snapshot));
                }
                catch { /* A failed UI subscriber must not change engine state. */ }
            }
    };
    const log = (level: 'info' | 'warn' | 'error', message: string) => { snapshot.logs.push({ at: new Date().toISOString(), level, message }); snapshot.logs = snapshot.logs.slice(-200); emit(); };
    let hardwareFlight: Promise<void> | undefined;
    function detectHardware(): Promise<void> {
        if (hardwareFlight) return hardwareFlight;
        hardwareFlight = (async () => {
            if (options.hardwareProbe) {
                try { snapshot.hardware = structuredClone(await options.hardwareProbe()); }
                catch { snapshot.hardware = { ...snapshot.hardware, gpuName: '未检测到 NVIDIA 显卡', vramMb: 0, driver: '未知', cudaVersion: undefined }; }
                emit(); return;
            }
            const [query, summary] = await Promise.allSettled([
                promisify(execFile)('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 }),
                promisify(execFile)('nvidia-smi', [], { windowsHide: true, timeout: 5000 })
            ]);
            if (query.status === 'fulfilled') {
                const [gpuName, vram, driver] = query.value.stdout.trim().split('\n')[0].split(',').map(s => s.trim());
                snapshot.hardware = { ...snapshot.hardware, gpuName, vramMb: Number(vram) || 0, driver: driver || '未知', cudaVersion: summary.status === 'fulfilled' ? parseNvidiaCudaVersion(summary.value.stdout) : undefined };
            } else snapshot.hardware = { ...snapshot.hardware, gpuName: '未检测到 NVIDIA 显卡', vramMb: 0, driver: '未知', cudaVersion: undefined };
            emit();
        })().finally(() => { hardwareFlight = undefined; });
        return hardwareFlight;
    }
    const hardwareReady = detectHardware();
    let writes = Promise.resolve();
    const persist = () => {
        if (disposed)
            return writes;
        for (const key of ['settings', 'tasks', 'presets'])
            db.run('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)', [key, JSON.stringify((snapshot as any)[key])]);
        const exported = Buffer.from(db.export());
        writes = writes.catch(() => {}).then(async () => { await fs.writeFile(dbPath + '.tmp', exported); await fs.rename(dbPath + '.tmp', dbPath); });
        return writes;
    };
    async function api(endpoint: string, init: RequestInit = {}, timeout = 10000): Promise<any> {
        const response = await fetch(snapshot.settings.engineUrl + endpoint, { ...init, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(timeout), shutdownController.signal]) });
        if (!response.ok) {
            let detail = '';
            try {
                const data = await response.json();
                detail = typeof data.error?.message === 'string' ? data.error.message : typeof data.error === 'string' ? data.error : '';
            }
            catch { }
            throw new Error(`引擎请求失败（${response.status}）${detail ? ': ' + detail.slice(0, 300) : ''}`);
        }
        return response.json();
    }
    const post = (endpoint: string, data: unknown) => api(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    async function scan() {
        h3Runtime = await getH3Runtime(snapshot.settings.installationPath, snapshot.settings.modelPath);
        const defaults = h3Runtime.defaults;
        const lite = h3Runtime.tier === 'lite' || h3Runtime.tier === 'lite-audio';
        Object.assign(snapshot.templates[0], { installationTier: h3Runtime.tier, audio: defaults.audio, defaultResolution: { width: defaults.width, height: defaults.height }, defaultSteps: defaults.steps, frames: defaults.frames, fps: defaults.fps, models: h3Runtime.modelSpecs.map(([, name]) => name), resolutions: [{ label: `${defaults.width} × ${defaults.height}`, width: defaults.width, height: defaults.height }, { label: `${defaults.height} × ${defaults.width} · 竖屏`, width: defaults.height, height: defaults.width }], name: h3Runtime.tier === 'lite' ? 'MiniMax H3 Lite · 视频' : h3Runtime.tier === 'lite-audio' ? 'MiniMax H3 Lite · 音画实验' : 'MiniMax H3 · 图生视频', description: lite ? `社区低显存图生与文生视频；20 步，${defaults.audio ? '含实验音频' : '不含音频'}，首次仍需试跑` : `支持首帧或纯提示词，默认约 ${(defaults.frames / defaults.fps).toFixed(2)} 秒含音频视频` });
        snapshot.resources = await Promise.all(h3Runtime.modelSpecs.map(async ([folder, name]) => {
            const file = path.join(snapshot.settings.modelPath, folder, name);
            try {
                const st = await fs.stat(file);
                return { id: name, name, path: file, sizeBytes: st.size, status: st.isFile() && st.size > 0 ? 'installed' as const : 'missing' as const, kind: 'model' as const };
            }
            catch {
                return { id: name, name, path: file, sizeBytes: 0, status: 'missing' as const, kind: 'model' as const };
            }
        }));
        try {
            await getEngineInstallation(snapshot.settings.installationPath);
            snapshot.settings.initialized = true;
        }
        catch {
            snapshot.settings.initialized = false;
        }
        emit();
        return snapshot.resources;
    }
    async function validate() {
        await scan();
        const issues = snapshot.resources.filter(x => x.status === 'missing').map(x => '缺少模型：' + x.name);
        try {
            const info = await api('/object_info');
            const templateGraph = buildWorkflow({ templateId: 'h3-i2v', prompt: 'Dependency validation', ...h3Runtime.defaults, seed: 0 }, 'first-frame.png', 'dependency-check', h3Runtime.tier);
            for (const node of Object.values(templateGraph))
                if (!info[node.class_type])
                    issues.push('缺少节点：' + node.class_type);
            for (const node of Object.values(templateGraph))
                for (const [key, value] of Object.entries(node.inputs)) {
                    if (typeof value === 'string' && ((key.endsWith('_name') && key !== 'sampler_name') || key === 'projection')) {
                        const enumeration = (info[node.class_type]?.input?.required?.[key] ?? info[node.class_type]?.input?.optional?.[key])?.[0];
                        if (Array.isArray(enumeration) && !enumeration.includes(value))
                            issues.push('引擎未识别模型：' + value);
                    }
                }
        }
        catch {
            issues.push('引擎未连接，无法检查节点');
        }
        snapshot.templates[0].issues = [...new Set(issues)];
        snapshot.templates[0].ready = issues.length === 0;
        emit();
        return snapshot.templates[0];
    }
    function connectWs() {
        if (socket || disposed || closing)
            return;
        socket = new WebSocket(snapshot.settings.engineUrl.replace(/^http/, 'ws') + '/ws?clientId=' + clientId);
        socket.on('error', () => { });
        socket.on('close', () => { socket = undefined; });
        socket.on('message', (buffer, isBinary) => {
            if (isBinary)
                return;
            try {
                const event = JSON.parse(buffer.toString());
                const data = event.data ?? {};
                const task = snapshot.tasks.find(t => t.promptId === data.prompt_id && activeStatuses.includes(t.status));
                if (!task)
                    return;
                if (event.type === 'progress') {
                    task.progress = { value: data.value, max: data.max, node: data.node };
                    task.stage = '正在采样';
                }
                if (event.type === 'executing' && data.node) {
                    task.status = 'running';
                    task.stage = '正在执行节点 ' + data.node;
                }
                if (event.type === 'execution_error') {
                    task.status = 'failed';
                    task.error = String(data.exception_message ?? '执行失败').slice(0, 500);
                }
                task.updatedAt = new Date().toISOString();
                emit();
                if (['execution_success', 'execution_error', 'execution_interrupted'].includes(event.type))
                    void refresh().catch(() => { });
            }
            catch { }
        });
    }
    function refresh(): Promise<Snapshot> {
        if (disposed || closing) return Promise.resolve(structuredClone(snapshot));
        if (refreshFlight) return refreshFlight;
        refreshFlight = refreshImpl().finally(() => { refreshFlight = undefined; });
        return refreshFlight;
    }
    async function refreshImpl(): Promise<Snapshot> {
        try {
            const stats = await api('/system_stats', {}, 3000);
            if (!stats.system || !Array.isArray(stats.devices))
                throw new Error('端口服务不是 ComfyUI');
            const queue = await api('/queue');
            snapshot.engine.status = queue.queue_running?.length ? 'busy' : 'ready';
            snapshot.engine.queue = (queue.queue_running?.length ?? 0) + (queue.queue_pending?.length ?? 0);
            snapshot.engine.message = '引擎已连接';
            snapshot.engine.managed = !!child;
            snapshot.engine.version = stats.system.comfyui_version;
            connectWs();
            let changed = false;
            for (const task of snapshot.tasks.filter(t => activeStatuses.includes(t.status) && !t.promptId)) {
                const entry = [...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].find((e: any) => e[3]?.luckyx_task_id === task.id);
                if (entry) {
                    task.promptId = entry[1];
                    changed = true;
                }
                else if (task.status === 'unknown') {
                    const all = await api('/history?max_items=100');
                    for (const [pid, h] of Object.entries(all) as [
                        string,
                        any
                    ][]) {
                        if (h?.prompt?.[3]?.luckyx_task_id === task.id) {
                            task.promptId = pid;
                            changed = true;
                            break;
                        }
                    }
                }
            }
            for (const task of snapshot.tasks.filter(t => activeStatuses.includes(t.status) && t.promptId)) {
                const previous = JSON.stringify(task);
                const result = await api('/history/' + encodeURIComponent(task.promptId!));
                const history = result[task.promptId!];
                if (history?.status?.completed || ['success', 'error'].includes(history?.status?.status_str)) {
                    task.outputs = mapHistoryOutputs(history, task.id, options.outputBaseUrl);
                    const messages = history.status.messages ?? [];
                    const interrupted = messages.some((m: any) => m[0] === 'execution_interrupted');
                    task.status = history.status.status_str === 'success' && task.outputs.length ? 'completed' : interrupted ? 'interrupted' : 'failed';
                    task.stage = task.status === 'completed' ? '生成完成' : task.status === 'interrupted' ? '已取消' : '生成失败';
                    if (task.status === 'failed')
                        task.error = String(messages.find((m: any) => m[0] === 'execution_error')?.[1]?.exception_message ?? '引擎未返回可用视频');
                }
                else if (isPromptRunning(queue, task.promptId!)) {
                    task.status = 'running';
                    task.stage = '正在生成';
                }
                else if ((queue.queue_pending ?? []).some((e: any) => e[1] === task.promptId)) {
                    task.status = 'queued';
                    task.stage = '排队中';
                }
                else if (task.status !== 'unknown') {
                    task.status = 'unknown';
                    task.stage = '任务不在队列中，等待历史记录';
                }
                if (JSON.stringify(task) !== previous) {
                    task.updatedAt = new Date().toISOString();
                    changed = true;
                }
            }
            if (changed)
                await persist();
        }
        catch {
            snapshot.engine.status = child && startBusy ? 'starting' : 'offline';
            snapshot.engine.message = '引擎未连接，请启动或检查本机服务';
            snapshot.templates[0].ready = false;
            socket?.close();
        }
        finally {
            emit();
        }
        return structuredClone(snapshot);
    }
    function start(): Promise<unknown> {
        if (startFlight)
            return startFlight;
        startFlight = startImpl().finally(() => { startFlight = undefined; });
        return startFlight;
    }
    async function startImpl() {
        if (disposed || closing) throw new Error('启动器正在退出');
        if (startBusy)
            return snapshot.engine;
        await refresh();
        if (['ready', 'busy'].includes(snapshot.engine.status))
            return snapshot.engine;
        if (new URL(snapshot.settings.engineUrl).port !== '8188')
            throw new Error('自定义端口请先手动启动引擎');
        if (child)
            return snapshot.engine;
        const root = snapshot.settings.installationPath;
        await scan();
        const installation = await getEngineInstallation(root);
        for (const dir of [snapshot.settings.inputPath, snapshot.settings.outputPath, path.join(options.dataDir, 'comfy-user')])
            await fs.mkdir(dir, { recursive: true });
        startBusy = true;
        if (closing) { startBusy = false; throw new Error('启动器正在退出'); }
        snapshot.engine.status = 'starting';
        snapshot.engine.message = '正在启动本地引擎';
        emit();
        child = (options.spawnEngine ?? spawn)(installation.python, [...installation.args, ...h3Runtime.launchArgs, '--listen', '127.0.0.1', '--port', '8188', '--reserve-vram', ['lite', 'lite-audio'].includes(h3Runtime.tier) ? '0.5' : '1.5', '--cache-none', '--input-directory', snapshot.settings.inputPath, '--output-directory', snapshot.settings.outputPath, '--user-directory', path.join(options.dataDir, 'comfy-user')], { cwd: installation.cwd, windowsHide: true, env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HOME: path.join(root, 'cache/huggingface'), PYTHONDONTWRITEBYTECODE: '1' } });
        snapshot.engine.managed = true;
        snapshot.engine.pid = child.pid;
        child.stdout?.on('data', b => log('info', b.toString().trim().slice(-1000)));
        child.stderr?.on('data', b => log('info', b.toString().trim().slice(-1000)));
        child.on('error', () => { log('error', '引擎进程启动失败'); child = undefined; startBusy = false; snapshot.engine.status = 'error'; emit(); });
        child.on('exit', code => { child = undefined; startBusy = false; snapshot.engine.pid = undefined; snapshot.engine.managed = false; snapshot.engine.status = code === 0 ? 'offline' : 'error'; snapshot.engine.message = '引擎已退出'; emit(); });
        log('info', '已启动本地 ComfyUI；首次加载可能需要等待');
        startBusy = false;
        return structuredClone(snapshot.engine);
    }
    async function cancel(id: string) {
        const task = snapshot.tasks.find(t => t.id === id);
        if (!task?.promptId || !activeStatuses.includes(task.status))
            throw new Error('任务当前不能取消');
        const queue = await api('/queue');
        if (isPromptRunning(queue, task.promptId)) {
            await post('/interrupt', {});
            task.stage = '已请求取消，等待引擎确认';
        }
        else if ((queue.queue_pending ?? []).some((e: any) => e[1] === task.promptId)) {
            await post('/queue', { delete: [task.promptId] });
            task.status = 'interrupted';
            task.stage = '已取消排队';
        }
        else
            throw new Error('无法确认任务在队列中，请先刷新');
        task.updatedAt = new Date().toISOString();
        await persist();
        emit();
        return task;
    }
    async function stop() {
        if (!child)
            throw new Error('此引擎由外部程序启动，请在原窗口停止');
        const queue = await api('/queue').catch(() => null);
        if (queue?.queue_running?.length) {
            const id = queue.queue_running[0][1];
            if (!snapshot.tasks.some(t => t.promptId === id))
                throw new Error('引擎正在执行外部任务，请等待任务结束');
            await post('/interrupt', {});
        }
        child.kill();
        return snapshot.engine;
    }
    async function submit(value: unknown) {
        if (closing) throw new Error('启动器正在退出，不能提交新任务');
        await scan();
        const params = validateGenerationParams(value, h3Runtime.defaults.steps);
        const image = params.mode === 'text' ? undefined : validateImage(params.image);
        await refresh();
        if (!['ready', 'busy'].includes(snapshot.engine.status))
            throw new Error('请先启动引擎');
        await validate();
        if (!snapshot.templates[0].ready)
            throw new Error(snapshot.templates[0].issues.join('；'));
        const id = randomUUID();
        const now = new Date().toISOString();
        const task: TaskRecord = { id, title: params.prompt.slice(0, 32), status: 'submitting', createdAt: now, updatedAt: now, params: { ...params, image: undefined }, stage: params.mode === 'text' ? '提交纯提示词任务' : '上传首帧', outputs: [] };
        snapshot.tasks.unshift(task);
        await persist();
        emit();
        let promptSent = false;
        try {
            if (image) {
                const form = new FormData();
                form.append('image', new Blob([image.bytes as BlobPart], { type: image.mime }), id + '-' + image.name);
                form.append('type', 'input');
                form.append('overwrite', 'false');
                const uploaded = await api('/upload/image', { method: 'POST', body: form }, 30000);
                if (typeof uploaded.name !== 'string' || !safeOutputPath(uploaded.name, uploaded.subfolder ?? ''))
                    throw new Error('引擎返回了无效图片路径');
                task.inputImage = [uploaded.subfolder, uploaded.name].filter(Boolean).join('/');
            }
            if (closing) throw new Error('应用退出，提交已取消');
            promptSent = true;
            const result = await post('/prompt', { client_id: clientId, prompt: buildWorkflow(params, task.inputImage ?? '', id, h3Runtime.tier), extra_data: { luckyx_task_id: id } });
            if (typeof result.prompt_id !== 'string')
                throw new Error('引擎未确认任务编号');
            task.promptId = result.prompt_id;
            task.status = 'queued';
            task.stage = '排队中';
        }
        catch (e: any) {
            const uncertain = promptSent && !/^引擎请求失败（4\d\d）/.test(e.message ?? '');
            task.status = uncertain ? 'unknown' : 'failed';
            task.error = e.message ?? '提交失败';
            task.stage = uncertain ? '提交结果待确认，请检查引擎队列' : '提交失败';
        }
        task.updatedAt = new Date().toISOString();
        await persist();
        emit();
        return structuredClone(task);
    }
    async function saveSettings(payload: unknown) {
        if (bootstrapFlight)
            throw new Error('正在安装环境，请完成或暂停后再修改连接设置');
        if (child)
            throw new Error('请先停止由启动器管理的引擎，再修改设置');
        const next = { ...snapshot.settings, ...payload as Partial<Settings> };
        next.engineUrl = validateEngineUrl(next.engineUrl);
        for (const key of ['installationPath', 'modelPath', 'inputPath', 'outputPath'] as const) {
            if (typeof next[key] !== 'string' || !path.isAbsolute(next[key]) || next[key].includes('\0'))
                throw new Error('请选择有效的绝对路径');
        }
        if (snapshot.tasks.some(t => ['running', 'queued', 'submitting'].includes(t.status)))
            throw new Error('有未完成任务时不能切换环境');
        snapshot.settings = next;
        socket?.close();
        await scan();
        await persist();
        await refresh();
        return structuredClone(snapshot.settings);
    }
    async function connectBootstrapInstallation(localRestore = false) {
        await bootstrap.ready;
        if (closing || disposed) throw new Error('启动器正在退出');
        if (bootstrapFlight) throw new Error('安装仍在进行，请等待完成后连接');
        const target = await bootstrap.completedInstallation();
        const modelPath = path.join(target, 'ComfyUI/models');
        if (path.resolve(snapshot.settings.installationPath) === path.resolve(target) && path.resolve(snapshot.settings.modelPath) === path.resolve(modelPath)) {
            await scan();
            if (snapshot.settings.initialized) { bootstrapConnectionError = undefined; return { connected: true, alreadyConnected: true }; }
        }
        if (!localRestore) await refresh();
        if (closing || disposed) throw new Error('启动器正在退出');
        if (child || startFlight || ['ready', 'busy'].includes(snapshot.engine.status) || snapshot.tasks.some(task => activeStatuses.includes(task.status))) throw new Error('请先停止现有引擎并完成任务，再连接已安装环境');
        const previous = structuredClone(snapshot.settings);
        snapshot.settings = { ...snapshot.settings, installationPath: target, modelPath, engineUrl: 'http://127.0.0.1:8188' };
        socket?.close();
        await scan();
        try { await persist(); }
        catch { snapshot.settings = previous; await scan(); throw new Error('环境已安装，但连接设置保存失败。请重试连接已安装环境'); }
        bootstrapConnectionError = undefined;
        emit();
        return { connected: true, alreadyConnected: false };
    }
    async function retry(payload: unknown) {
        const task = snapshot.tasks.find(t => t.id === (payload as any)?.id);
        if (!task || !['failed', 'interrupted'].includes(task.status))
            throw new Error('请选择失败或已取消的任务');
        if (task.params.templateId.startsWith('workflow:'))
            throw new Error('自定义工作流请回到工作流库重新确认参数和素材后生成');
        await scan();
        const params = validateGenerationParams(task.params, h3Runtime.defaults.steps);
        if (params.mode !== 'text' && !task.inputImage)
            throw new Error('请重新上传首帧图片后生成');
        await refresh();
        if (!['ready', 'busy'].includes(snapshot.engine.status))
            throw new Error('请先启动引擎');
        await validate();
        if (!snapshot.templates[0].ready)
            throw new Error('模板依赖未就绪');
        const cloned: TaskRecord = { ...structuredClone(task), params: { ...params, image: undefined }, id: randomUUID(), promptId: undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), outputs: [], error: undefined, status: 'submitting', stage: '重新提交' };
        snapshot.tasks.unshift(cloned);
        await persist();
        try {
            const result = await post('/prompt', { client_id: clientId, prompt: buildWorkflow(params, task.inputImage ?? '', cloned.id, h3Runtime.tier), extra_data: { luckyx_task_id: cloned.id } });
            if (typeof result.prompt_id !== 'string')
                throw new Error('引擎未确认任务编号');
            cloned.promptId = result.prompt_id;
            cloned.status = 'queued';
            cloned.stage = '排队中';
        }
        catch (e: any) {
            cloned.status = /^引擎请求失败（4\d\d）/.test(e.message ?? '') ? 'failed' : 'unknown';
            cloned.stage = cloned.status === 'unknown' ? '提交结果待确认，请检查引擎队列' : '提交失败';
            cloned.error = e.message;
        }
        await persist();
        emit();
        return cloned;
    }
    function workflowDocument(payload: unknown): UserWorkflowDocument {
        const id = (payload as {
            id?: unknown;
        } | null)?.id;
        if (typeof id !== 'string' || !id || id.length > 128)
            throw new Error('请选择有效的工作流');
        const row = db.exec('SELECT metadata,json FROM user_workflows WHERE id = ?', [id])[0]?.values[0];
        if (!row)
            throw new Error('工作流不存在或已移除');
        return { metadata: JSON.parse(String(row[0])) as UserWorkflow, json: String(row[1]) };
    }
    function workflowAnalysis(payload: unknown) {
        const document = workflowDocument(payload);
        const parsed = parseWorkflowJson(document.json);
        if (parsed.format !== 'api') return { metadata: document.metadata, status: 'editor-only' as const, message: '节点画布格式需要先在 ComfyUI 导出 API 格式后再导入。' };
        const analysis = analyzeWorkflowParameters(parsed);
        return { metadata: document.metadata, status: analysis.features.videoOutput ? 'ready' as const : 'unsupported' as const, analysis,
            message: analysis.features.videoOutput ? '已识别可编辑内容和生成参数。' : '没有识别到受支持的视频输出节点。' };
    }
    async function runUserWorkflow(payload: unknown): Promise<TaskRecord> {
        if (closing) throw new Error('启动器正在退出，不能提交新任务');
        const input = payload as { id?: unknown; values?: unknown } | null;
        const document = workflowDocument({ id: input?.id });
        const parsed = parseWorkflowJson(document.json);
        const analysis = analyzeWorkflowParameters(parsed);
        if (!analysis.features.videoOutput) throw new Error('工作流没有可识别的视频输出节点，请在节点编辑器检查');
        if (!input?.values || typeof input.values !== 'object' || Array.isArray(input.values)) throw new Error('请填写工作流需要的内容');
        const values = { ...(input.values as Record<string, unknown>) };
        const mediaSlots = analysis.slots.filter(slot => slot.editable && ['image', 'video', 'audio'].includes(slot.kind));
        if (mediaSlots.some(slot => slot.kind !== 'image')) throw new Error('当前版本已识别视频或音频素材槽位，请先在节点编辑器配置；工作台直传将在后续版本提供');
        await refresh();
        if (!['ready', 'busy'].includes(snapshot.engine.status)) throw new Error('请先启动引擎');
        const info = await api('/object_info');
        const missing = [...new Set(Object.values(parsed.graph).map((node: any) => node?.class_type).filter((type): type is string => typeof type === 'string' && !info[type]))];
        if (missing.length) throw new Error('工作流缺少节点：' + missing.join('、'));
        const uploadedNames: string[] = [];
        for (const slot of mediaSlots) {
            const image = validateImage(values[slot.id] as GenerationParams['image']);
            const form = new FormData();
            const uploadId = randomUUID();
            form.append('image', new Blob([image.bytes as BlobPart], { type: image.mime }), uploadId + '-' + image.name);
            form.append('type', 'input'); form.append('overwrite', 'false');
            const uploaded = await api('/upload/image', { method: 'POST', body: form }, 30000);
            if (typeof uploaded.name !== 'string' || !safeOutputPath(uploaded.name, uploaded.subfolder ?? '')) throw new Error('引擎返回了无效图片路径');
            const uploadedName = [uploaded.subfolder, uploaded.name].filter(Boolean).join('/');
            uploadedNames.push(uploadedName); values[slot.id] = uploadedName;
        }
        const applied = applyWorkflowParameterValues(parsed, analysis, values);
        const valueOf = (kind: string, fallback: number | string) => {
            const slot = analysis.slots.find(item => item.kind === kind); const node = slot ? applied.graph[slot.nodeId] as any : undefined;
            return slot ? node?.inputs?.[slot.inputName] ?? fallback : fallback;
        };
        const prompt = String(valueOf('prompt', document.metadata.name));
        const params: GenerationParams = { templateId: `workflow:${document.metadata.id}`, mode: mediaSlots.length ? 'image' : 'text', prompt,
            width: Number(valueOf('width', 864)), height: Number(valueOf('height', 480)), frames: Number(valueOf('frames', 1)),
            steps: Number(valueOf('steps', 1)), seed: Number(valueOf('seed', 0)) };
        const id = randomUUID(), now = new Date().toISOString();
        const task: TaskRecord = { id, title: document.metadata.name, status: 'submitting', createdAt: now, updatedAt: now, params, stage: '提交自定义工作流', outputs: [], ...(uploadedNames[0] ? { inputImage: uploadedNames[0] } : {}) };
        snapshot.tasks.unshift(task); await persist(); emit();
        let promptSent = false;
        try {
            promptSent = true;
            const result = await post('/prompt', { client_id: clientId, prompt: applied.graph, extra_data: { luckyx_task_id: id, luckyx_workflow_id: document.metadata.id } });
            if (typeof result.prompt_id !== 'string') throw new Error('引擎未确认任务编号');
            task.promptId = result.prompt_id; task.status = 'queued'; task.stage = '排队中';
        } catch (error: any) {
            const uncertain = promptSent && !/^引擎请求失败（4\d\d）/.test(error.message ?? '');
            task.status = uncertain ? 'unknown' : 'failed'; task.stage = uncertain ? '提交结果待确认，请检查引擎队列' : '提交失败'; task.error = error.message ?? '提交失败';
        }
        task.updatedAt = new Date().toISOString(); await persist(); emit(); return structuredClone(task);
    }
    async function importWorkflow(payload: unknown, recipeId?: string): Promise<UserWorkflow> {
        const input = payload as {
            name?: unknown;
            json?: unknown;
        } | null;
        const name = validateWorkflowName(input?.name);
        const json = input?.json;
        if (typeof json !== 'string')
            throw new Error('请提供工作流 JSON 文本');
        const parsed = parseWorkflowJson(json);
        const now = new Date().toISOString();
        const metadata: UserWorkflow = { ...(recipeId ? { recipeId } : {}), id: randomUUID(), name, format: parsed.format, nodeCount: parsed.nodeCount, createdAt: now, updatedAt: now };
        db.run('INSERT INTO user_workflows(id,metadata,json) VALUES(?,?,?)', [metadata.id, JSON.stringify(metadata), json]);
        snapshot.userWorkflows.unshift(metadata);
        await persist();
        emit();
        return structuredClone(metadata);
    }
    async function updateWorkflow(payload: unknown, renameOnly: boolean): Promise<UserWorkflow> {
        const document = workflowDocument(payload);
        const input = payload as {
            name?: unknown;
            json?: unknown;
        };
        let json = document.json;
        const metadata = { ...document.metadata, updatedAt: new Date().toISOString() };
        if (renameOnly)
            metadata.name = validateWorkflowName(input.name);
        else {
            if (typeof input.json !== 'string')
                throw new Error('请提供工作流 JSON 文本');
            const parsed = parseWorkflowJson(input.json);
            json = input.json;
            metadata.format = parsed.format;
            metadata.nodeCount = parsed.nodeCount;
        }
        db.run('UPDATE user_workflows SET metadata = ?, json = ? WHERE id = ?', [JSON.stringify(metadata), json, metadata.id]);
        const index = snapshot.userWorkflows.findIndex(workflow => workflow.id === metadata.id);
        if (index >= 0)
            snapshot.userWorkflows[index] = metadata;
        await persist();
        emit();
        return structuredClone(metadata);
    }
    async function removeWorkflow(payload: unknown): Promise<{
        id: string;
    }> {
        const { metadata } = workflowDocument(payload);
        db.run('DELETE FROM user_workflows WHERE id = ?', [metadata.id]);
        snapshot.userWorkflows = snapshot.userWorkflows.filter(workflow => workflow.id !== metadata.id);
        await persist();
        emit();
        return { id: metadata.id };
    }
    async function recipes(): Promise<VideoRecipeEntry[]> {
        let info: Record<string, any> | undefined;
        try {
            const stats = await api('/system_stats', {}, 3000);
            if (!stats.system || !Array.isArray(stats.devices))
                throw new Error('本机服务不是 ComfyUI');
            info = await api('/object_info');
        }
        catch {
            info = undefined;
        }
        return Promise.all(videoRecipeDefinitions.map(async (definition) => {
            const { graph, ...entry } = definition;
            const missingNodes = info ? [...new Set(Object.values(graph).map(node => node.class_type).filter(type => !info![type]))] : [];
            const missingModels = new Set<string>();
            const issues: string[] = info ? [] : ['引擎离线，无法确认节点和模型枚举'];
            for (const model of definition.models) {
                const target = path.join(snapshot.settings.modelPath, model.folder, model.name);
                try {
                    const stat = await fs.stat(target);
                    if (!stat.isFile() || stat.size <= 0)
                        throw new Error();
                }
                catch {
                    missingModels.add(model.name);
                }
            }
            if (info)
                for (const node of Object.values(graph)) {
                    const field = MODEL_LOADER_FIELDS[node.class_type];
                    if (!field || !info[node.class_type])
                        continue;
                    const model = node.inputs[field];
                    if (typeof model !== 'string')
                        continue;
                    const schema = info[node.class_type].input?.required?.[field] ?? info[node.class_type].input?.optional?.[field];
                    const choices = Array.isArray(schema?.[0]) ? schema[0] : schema?.[1]?.options;
                    if (!Array.isArray(choices) || !choices.includes(model))
                        missingModels.add(model);
                }
            issues.push(...missingNodes.map(name => '缺少原生节点：' + name), ...[...missingModels].map(name => '缺少模型或引擎未识别：' + name));
            return { ...structuredClone(entry), status: !info ? 'offline' : missingNodes.length || missingModels.size ? 'missing' : 'available', issues, missingNodes, missingModels: [...missingModels] } as VideoRecipeEntry;
        }));
    }
    async function recipeImport(payload: unknown): Promise<UserWorkflow> {
        const id = (payload as {
            id?: unknown;
        } | null)?.id;
        const definition = videoRecipeDefinitions.find(recipe => recipe.id === id);
        if (!definition)
            throw new Error('请选择有效的视频改造工作流');
        const existing = snapshot.userWorkflows.find(workflow => workflow.recipeId === definition.id);
        if (existing)
            return structuredClone(existing);
        return importWorkflow({ name: definition.name, json: JSON.stringify(definition.graph, null, 2) }, definition.id);
    }
    function shutdown(): Promise<void> {
        if (shutdownFlight) return shutdownFlight;
        closing = true;
        shutdownFlight = (async () => {
            clearInterval(timer);
            socket?.close();
            shutdownController.abort();
            bootstrap.cancel();
            resourceController?.abort();
            const ownedChild = child;
            if (ownedChild && child === ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null) {
                const exit = new Promise<void>(resolve => { ownedChild.once('exit', () => resolve()); ownedChild.once('error', () => resolve()); });
                if (options.terminateEngine) await options.terminateEngine(ownedChild);
                else if (process.platform === 'win32' && Number.isSafeInteger(ownedChild.pid) && ownedChild.pid! > 0) {
                    await promisify(execFile)('taskkill.exe', ['/PID', String(ownedChild.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 }).catch(() => { ownedChild.kill(); });
                } else ownedChild.kill();
                await Promise.race([exit, new Promise<void>(resolve => { const deadline = setTimeout(resolve, 4000); deadline.unref(); })]);
            }
            await bootstrap.dispose();
            await initialization?.catch(() => {});
            await refreshFlight?.catch(() => {});
            await bootstrapFlight?.catch(() => {});
            await resourceFlight?.catch(() => {});
            await startFlight?.catch(() => {});
            await submitChain;
            if (ownedChild) {
                for (const task of snapshot.tasks.filter(task => activeStatuses.includes(task.status))) {
                    task.status = 'interrupted'; task.stage = '应用退出，任务已中断'; task.updatedAt = new Date().toISOString();
                }
                await persist();
            }
            await writes;
        })();
        return shutdownFlight;
    }
    const service: StudioService = {
        async invoke(command, payload) {
            if (command === 'snapshot' && initializationFailed && !closing && !disposed) initialization = initialize();
            if (command !== 'lifecycle.shutdown') await initialization;
            if (disposed)
                throw new Error('启动器已关闭');
            if (closing && !['lifecycle.shutdown', 'snapshot', 'bootstrap.status'].includes(command)) throw new Error('启动器正在退出');
            switch (command) {
                case 'lifecycle.shutdown': await shutdown(); return { stopped: true };
                case 'bootstrap.status': await bootstrap.ready; bootstrapPlan ??= bootstrap.snapshot().plan; return { ...bootstrap.snapshot(), ...(bootstrapConnectionError ? { error: bootstrapConnectionError } : {}) };
                case 'bootstrap.plan': {
                    if (bootstrapFlight) throw new Error('安装正在进行');
                    const p = payload as { rootPath?: unknown; profile?: unknown } | null;
                    if (typeof p?.rootPath !== 'string' || (p.profile !== undefined && !['environment', 'h3', 'h3-lite-audio'].includes(String(p.profile)))) throw new Error('请选择安装目录和安装内容');
                    bootstrapPlan = undefined;
                    await hardwareReady;
                    await detectHardware();
                    bootstrapPlan = await bootstrap.plan({ rootPath: p.rootPath, hardware: snapshot.hardware, profile: (p.profile ?? 'h3') as import('../shared/bootstrap').H3InstallationProfile });
                    bootstrapConnectionError = undefined;
                    return bootstrapPlan;
                }
                case 'bootstrap.cancel': return bootstrap.cancel();
                case 'bootstrap.connect': return connectBootstrapInstallation();
                case 'bootstrap.start': {
                    await bootstrap.ready;
                    bootstrapPlan ??= bootstrap.snapshot().plan;
                    if (bootstrapFlight) return { started: true };
                    if (!bootstrapPlan) throw new Error('请先检查安装条件');
                    await refresh();
                    if (child || ['ready', 'busy'].includes(snapshot.engine.status) || snapshot.tasks.some(t => activeStatuses.includes(t.status))) throw new Error('请先停止现有引擎并完成任务，再安装和切换新环境');
                    const plan = bootstrapPlan;
                    bootstrapConnectionError = undefined;
                    bootstrapFlight = (async () => {
                        const result = await bootstrap.start(plan);
                        if (result.status !== 'completed' || !result.installationPath || disposed) return;
                        snapshot.settings = { ...snapshot.settings, installationPath: result.installationPath, modelPath: path.join(result.installationPath, 'ComfyUI/models'), engineUrl: 'http://127.0.0.1:8188' };
                        await scan(); await persist();
                        if (closing) return;
                        await start();
                        const deadline = Date.now() + 90000;
                        while (!disposed && !closing && Date.now() < deadline && child && !['ready', 'busy'].includes(snapshot.engine.status)) { await new Promise(resolve => setTimeout(resolve, 1000)); await refresh(); }
                        if (closing) return;
                        if (!['ready', 'busy'].includes(snapshot.engine.status)) throw new Error('文件已安装，但引擎未就绪。请查看启动日志或使用手动教程。');
                        if (plan.files.some(f => f.kind === 'model')) { await validate(); if (!snapshot.templates[0].ready) throw new Error('文件已安装，但 H3 节点检查未通过。请在资源中心查看缺失项和官方教程。'); }
                        log('info', '一键安装完成，已连接本地 ComfyUI');
                    })().catch(error => { bootstrapConnectionError = error instanceof Error ? error.message : '安装连接失败，请查看教程'; log('error', bootstrapConnectionError); }).finally(() => { bootstrapFlight = undefined; emit(); });
                    return { started: true };
                }
                case 'snapshot': return structuredClone(snapshot);
                case 'workflow.list': return structuredClone(snapshot.userWorkflows);
                case 'workflow.recipes': return recipes();
                case 'workflow.recipeImport': return recipeImport(payload);
                case 'workflow.get': return workflowDocument(payload);
                case 'workflow.analyze': return workflowAnalysis(payload);
                case 'workflow.run': return runUserWorkflow(payload);
                case 'workflow.import': return importWorkflow(payload);
                case 'workflow.create': return importWorkflow({ name: (payload as {
                        name?: unknown;
                    } | null)?.name ?? '未命名工作流', json: createEmptyWorkflowJson() });
                case 'workflow.rename': return updateWorkflow(payload, true);
                case 'workflow.update': return updateWorkflow(payload, false);
                case 'workflow.remove': return removeWorkflow(payload);
                case 'engine.start': return start();
                case 'engine.stop': return stop();
                case 'engine.restart':
                    await stop();
                    await new Promise<void>(resolve => {
                        if (!child)
                            resolve();
                        else
                            child.once('exit', () => resolve());
                    });
                    return start();
                case 'settings.save': return saveSettings(payload);
                case 'task.submit': {
                    const key = JSON.stringify(payload);
                    const existing = inflightSubmissions.get(key);
                    if (existing)
                        return existing;
                    const work = submitChain.then(() => submit(payload));
                    inflightSubmissions.set(key, work);
                    submitChain = work.then(() => { }, () => { });
                    try {
                        return await work;
                    }
                    finally {
                        inflightSubmissions.delete(key);
                    }
                }
                case 'task.cancel': return cancel((payload as any)?.id);
                case 'task.remove': {
                    const id = (payload as any)?.id;
                    if (typeof id !== 'string' || !id.trim())
                        throw new Error('请选择要删除的历史任务');
                    const task = snapshot.tasks.find(t => t.id === id);
                    if (!task)
                        throw new Error('任务不存在或已删除');
                    if (!canRemoveTask(task.status))
                        throw new Error('只能删除已完成、失败或已中断的任务；运行状态待确认的任务请先刷新');
                    // Refresh only updates existing active records; it never imports arbitrary
                    // engine history. Removing the record also removes its output references.
                    // The engine history and the user's media / workflow files stay untouched.
                    snapshot.tasks = snapshot.tasks.filter(t => t.id !== id);
                    await persist();
                    emit();
                    return { id };
                }
                case 'task.retry': {
                    const key = 'retry:' + String((payload as any)?.id);
                    const existing = inflightSubmissions.get(key);
                    if (existing)
                        return existing;
                    const work = submitChain.then(() => retry(payload));
                    inflightSubmissions.set(key, work);
                    submitChain = work.then(() => { }, () => { });
                    try {
                        return await work;
                    }
                    finally {
                        inflightSubmissions.delete(key);
                    }
                }
                case 'tasks.refresh': return refresh();
                case 'preset.save': {
                    const p = payload as any;
                    await scan();
                    const params = validateGenerationParams(p?.params, h3Runtime.defaults.steps);
                    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60)
                        throw new Error('预设名称须为 1–60 字符');
                    const preset = { id: randomUUID(), name: p.name.trim(), params: { ...params, image: undefined } };
                    snapshot.presets.push(preset);
                    await persist();
                    emit();
                    return preset;
                }
                case 'diagnostics.run':
                    await detectHardware();
                    await refresh();
                    await validate();
                    return { engine: snapshot.engine, issues: snapshot.templates[0].issues, hardware: snapshot.hardware };
                case 'template.validate': return validate();
                case 'resource.scan': return scan();
                case 'resource.catalog': return resourceInstaller.list();
                case 'resource.install.status': return resourceProgress ? structuredClone(resourceProgress) : undefined;
                case 'resource.install.cancel': resourceController?.abort(); return resourceProgress;
                case 'resource.install.start': {
                    const id = (payload as { id?: unknown } | null)?.id;
                    if (typeof id !== 'string' || !id) throw new Error('请选择要安装的资源');
                    if (resourceFlight) throw new Error('已有资源正在安装');
                    await refresh();
                    if (child || ['ready', 'busy'].includes(snapshot.engine.status) || snapshot.tasks.some(t => activeStatuses.includes(t.status))) throw new Error('请先停止引擎并完成当前任务，再安装模型或节点');
                    resourceController = new AbortController();
                    resourceProgress = { id, status: 'idle', receivedBytes: 0, totalBytes: 0, message: '准备安装' };
                    const controller = resourceController;
                    resourceFlight = resourceInstaller.install(id, controller.signal).then(result => { resourceProgress = result; })
                        .finally(() => { resourceFlight = undefined; if (resourceController === controller) resourceController = undefined; });
                    return { started: true };
                }
                case 'logs.clear':
                    snapshot.logs = [];
                    emit();
                    return true;
                default: throw new Error('不支持的操作');
            }
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async resolveMedia(taskId, index) {
            const task = snapshot.tasks.find(t => t.id === taskId);
            const output = Number.isInteger(index) && index >= 0 ? task?.outputs[index] : undefined;
            if (!output || !safeOutputPath(output.filename, output.subfolder) || output.type !== 'output')
                throw new Error('视频文件不存在');
            const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: 'output' });
            return { url: snapshot.settings.engineUrl + '/view?' + query, filename: output.filename };
        },
        async dispose() { if (disposed) return; await shutdown(); if (disposed) return; disposed = true; listeners.clear(); db.close(); }
    };
    const timer = setInterval(() => { if (initialized && !closing) void refresh().catch(() => {}); }, 2500);
    timer.unref();
    // Window construction must not wait for archive recovery or an offline engine.
    // IPC returns only the fully restored local snapshot, never a false first-run state.
    async function initialize(): Promise<void> {
        initializationFailed = false;
        try {
            await scan();
            if (closing || disposed) return;
            await bootstrap.ready;
            if (closing || disposed) return;
            if (!snapshot.settings.initialized && bootstrap.snapshot().status === 'completed') {
                try { await connectBootstrapInstallation(true); }
                catch (error: any) { bootstrapConnectionError = error.message ?? '已安装环境的连接设置尚未恢复，请重试连接'; log('warn', bootstrapConnectionError!); }
            }
            if (closing || disposed) return;
            await persist();
            initialized = true;
            emit();
            void refresh().catch(() => {});
        } catch (error) { initializationFailed = true; throw error; }
    }
    initialization = initialize();
    // The invoke gate reports initialization errors to the renderer's retry screen.
    void initialization.catch(() => {});
    return service;
}
