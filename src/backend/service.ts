import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import templateGraph from './workflows/h3-i2v.json';
import type { Snapshot, StudioService, TaskRecord, Settings, GenerationParams, UserWorkflow, UserWorkflowDocument, VideoRecipeEntry } from '../shared/contracts';
import { validateEngineUrl, validateGenerationParams, validateImage, buildWorkflow, mapHistoryOutputs, isPromptRunning, safeOutputPath } from '../shared/workflow';
import { parseWorkflowJson, validateWorkflowName, createEmptyWorkflowJson } from '../shared/workflow-library';
import { videoRecipeDefinitions, MODEL_LOADER_FIELDS } from '../shared/video-recipes';
const MODEL_SPECS = [['diffusion_models', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'], ['text_encoders', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'], ['vae', 'minimax_h3_video_vae_int8_convrot.safetensors'], ['vae', 'minimax_h3_audio_vae_fp32.safetensors'], ['loras', 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors']];
const activeStatuses = ['submitting', 'queued', 'running', 'unknown'];
export async function createStudioService(options: {
    dataDir: string;
    defaultInstallationPath?: string;
    outputBaseUrl?: string;
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
    const installationPath = options.defaultInstallationPath ?? 'F:/VideoModels/MiniMax-H3';
    const snapshot: Snapshot = { settings: { installationPath, modelPath: path.join(installationPath, 'ComfyUI/models'), outputPath: path.join(options.dataDir, 'output'), inputPath: path.join(options.dataDir, 'input'), engineUrl: 'http://127.0.0.1:8188', initialized: false }, engine: { status: 'offline', managed: false, queue: 0, message: '尚未连接引擎' }, hardware: { gpuName: '检测中', vramMb: 0, ramGb: Math.round(os.totalmem() / 1024 ** 3), driver: '未知' }, templates: [{ id: 'h3-i2v', name: 'MiniMax H3 · 图生视频', description: '支持首帧或纯提示词，默认约 5.17 秒含音频视频', ready: false, issues: ['尚未验证运行节点'], models: MODEL_SPECS.map(x => x[1]), resolutions: [{ label: '864 × 480', width: 864, height: 480 }, { label: '832 × 480', width: 832, height: 480 }], defaultSteps: 4, frames: 124, fps: 24 }], tasks: [], resources: [], logs: [], presets: [], userWorkflows: [] };
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
    const listeners = new Set<(s: Snapshot) => void>();
    let child: ChildProcess | undefined;
    let socket: WebSocket | undefined;
    let disposed = false;
    let refreshBusy = false;
    let startBusy = false;
    let startFlight: Promise<unknown> | undefined;
    let submitChain = Promise.resolve();
    const inflightSubmissions = new Map<string, Promise<unknown>>();
    const clientId = randomUUID();
    const emit = () => {
        if (!disposed)
            for (const listener of listeners) {
                try {
                    listener(structuredClone(snapshot));
                }
                catch { /* A failed UI subscriber must not change engine state. */ }
            }
    };
    const log = (level: 'info' | 'warn' | 'error', message: string) => { snapshot.logs.push({ at: new Date().toISOString(), level, message }); snapshot.logs = snapshot.logs.slice(-200); emit(); };
    let writes = Promise.resolve();
    const persist = () => {
        if (disposed)
            return writes;
        for (const key of ['settings', 'tasks', 'presets'])
            db.run('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)', [key, JSON.stringify((snapshot as any)[key])]);
        const exported = Buffer.from(db.export());
        writes = writes.then(async () => { await fs.writeFile(dbPath + '.tmp', exported); await fs.rename(dbPath + '.tmp', dbPath); });
        return writes;
    };
    async function api(endpoint: string, init: RequestInit = {}, timeout = 10000): Promise<any> {
        const response = await fetch(snapshot.settings.engineUrl + endpoint, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) });
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
        snapshot.resources = await Promise.all(MODEL_SPECS.map(async ([folder, name]) => {
            const file = path.join(snapshot.settings.modelPath, folder, name);
            try {
                const st = await fs.stat(file);
                return { id: name, name, path: file, sizeBytes: st.size, status: st.isFile() && st.size > 0 ? 'installed' as const : 'missing' as const, kind: 'model' as const };
            }
            catch {
                return { id: name, name, path: file, sizeBytes: 0, status: 'missing' as const, kind: 'model' as const };
            }
        }));
        const py = path.join(snapshot.settings.installationPath, 'venv/Scripts/python.exe');
        try {
            const entries = await Promise.all([py, path.join(snapshot.settings.installationPath, 'ComfyUI/main.py'), path.join(snapshot.settings.installationPath, 'launch_comfy.py')].map(file => fs.stat(file)));
            snapshot.settings.initialized = entries.every(entry => entry.isFile() && entry.size > 0);
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
            for (const node of Object.values(templateGraph))
                if (!info[node.class_type])
                    issues.push('缺少节点：' + node.class_type);
            for (const node of Object.values(templateGraph))
                for (const [key, value] of Object.entries(node.inputs)) {
                    if (typeof value === 'string' && key.endsWith('_name') && key !== 'sampler_name') {
                        const enumeration = info[node.class_type]?.input?.required?.[key]?.[0];
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
        if (socket || disposed)
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
    async function refresh() {
        if (refreshBusy || disposed)
            return snapshot;
        refreshBusy = true;
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
            refreshBusy = false;
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
        const python = path.join(root, 'venv/Scripts/python.exe');
        const launcher = path.join(root, 'launch_comfy.py');
        for (const file of [python, launcher, path.join(root, 'ComfyUI/main.py')]) {
            try {
                if (!(await fs.stat(file)).isFile())
                    throw 0;
            }
            catch {
                throw new Error('缺少启动文件：' + file);
            }
        }
        for (const dir of [snapshot.settings.inputPath, snapshot.settings.outputPath, path.join(options.dataDir, 'comfy-user')])
            await fs.mkdir(dir, { recursive: true });
        startBusy = true;
        snapshot.engine.status = 'starting';
        snapshot.engine.message = '正在启动本地引擎';
        emit();
        child = spawn(python, [launcher, '--listen', '127.0.0.1', '--port', '8188', '--reserve-vram', '1.5', '--cache-none', '--fast-disk', '--input-directory', snapshot.settings.inputPath, '--output-directory', snapshot.settings.outputPath, '--user-directory', path.join(options.dataDir, 'comfy-user')], { cwd: root, windowsHide: true, env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HOME: path.join(root, 'cache/huggingface'), PYTHONDONTWRITEBYTECODE: '1' } });
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
        const params = validateGenerationParams(value);
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
            promptSent = true;
            const result = await post('/prompt', { client_id: clientId, prompt: buildWorkflow(params, task.inputImage ?? '', id), extra_data: { luckyx_task_id: id } });
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
    async function retry(payload: unknown) {
        const task = snapshot.tasks.find(t => t.id === (payload as any)?.id);
        if (!task || !['failed', 'interrupted'].includes(task.status))
            throw new Error('请选择失败或已取消的任务');
        const params = validateGenerationParams(task.params);
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
            const result = await post('/prompt', { client_id: clientId, prompt: buildWorkflow(params, task.inputImage ?? '', cloned.id), extra_data: { luckyx_task_id: cloned.id } });
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
    const service: StudioService = {
        async invoke(command, payload) {
            if (disposed)
                throw new Error('启动器已关闭');
            switch (command) {
                case 'snapshot': return structuredClone(snapshot);
                case 'workflow.list': return structuredClone(snapshot.userWorkflows);
                case 'workflow.recipes': return recipes();
                case 'workflow.recipeImport': return recipeImport(payload);
                case 'workflow.get': return workflowDocument(payload);
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
                    const params = validateGenerationParams(p?.params);
                    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60)
                        throw new Error('预设名称须为 1–60 字符');
                    const preset = { id: randomUUID(), name: p.name.trim(), params: { ...params, image: undefined } };
                    snapshot.presets.push(preset);
                    await persist();
                    emit();
                    return preset;
                }
                case 'diagnostics.run':
                    await refresh();
                    await validate();
                    return { engine: snapshot.engine, issues: snapshot.templates[0].issues, hardware: snapshot.hardware };
                case 'template.validate': return validate();
                case 'resource.scan': return scan();
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
        async dispose() { disposed = true; clearInterval(timer); socket?.close(); listeners.clear(); await writes; db.close(); }
    };
    const timer = setInterval(() => { void refresh().catch(() => { }); }, 2500);
    timer.unref();
    await scan();
    await persist();
    await refresh();
    void promisify(execFile)('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 }).then(({ stdout }) => { const [gpuName, vram, driver] = stdout.trim().split('\n')[0].split(',').map(s => s.trim()); snapshot.hardware = { ...snapshot.hardware, gpuName, vramMb: Number(vram) || 0, driver }; emit(); }).catch(() => { snapshot.hardware.gpuName = '未检测到 NVIDIA 显卡'; emit(); });
    return service;
}
