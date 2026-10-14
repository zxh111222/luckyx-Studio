import template from '../backend/workflows/h3-i2v.json';
import liteTemplate from '../backend/workflows/h3-lite.json';
import type { GenerationParams, OutputFile } from './contracts';
import type { H3InstallationTier } from './bootstrap';
import { H3_MAX_PIXELS } from './h3-parameters';
export type ApiWorkflow = Record<string, {
    class_type: string;
    inputs: Record<string, unknown>;
}>;
export function validateEngineUrl(value: string): string {
    let u: URL;
    try {
        u = new URL(value);
    }
    catch {
        throw new Error('引擎地址格式无效');
    }
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== ''))
        throw new Error('仅支持本机 HTTP 引擎地址');
    return u.origin;
}
export function validateGenerationParams(value: unknown, expectedSteps = 4): GenerationParams {
    const p = value as GenerationParams;
    if (!p || p.templateId !== 'h3-i2v')
        throw new Error('请选择 MiniMax H3 视频模板');
    if (p.mode !== undefined && p.mode !== 'image' && p.mode !== 'text')
        throw new Error('请选择首帧图生视频或纯提示词文生视频模式');
    if (typeof p.prompt !== 'string' || !p.prompt.trim() || p.prompt.length > 10000)
        throw new Error('请填写提示词（最多 10000 字符）');
    if (![p.width, p.height].every(value => Number.isInteger(value) && value >= 256 && value <= 2048 && value % 32 === 0) || p.width * p.height > H3_MAX_PIXELS)
        throw new Error('宽高需为 256～2048 内的 32 倍数，总像素不能超过 1344×768');
    if (!Number.isInteger(p.frames) || p.frames < 5 || p.frames > 362 || (p.frames - 5) % 17 !== 0)
        throw new Error('帧数需在 5～362 内，并按 17n+5 对齐');
    if (p.steps !== expectedSteps)
        throw new Error(expectedSteps === 20 ? '当前 H3 Lite 模板固定 20 步' : '当前 Turbo 模板固定 4 步');
    if (!Number.isSafeInteger(p.seed) || p.seed < 0)
        throw new Error('种子必须为非负安全整数');
    return { ...p, mode: p.mode ?? 'image', prompt: p.prompt.trim() };
}
export function validateImage(image: GenerationParams['image']): {
    bytes: Uint8Array;
    name: string;
    mime: string;
} {
    if (!image || typeof image.dataBase64 !== 'string')
        throw new Error('请上传首帧图片');
    const raw = image.dataBase64.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
    if (!raw || raw.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw))
        throw new Error('图片内容无效或超过 10 MB');
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    if (bytes.length > 10 * 1024 * 1024)
        throw new Error('图片不能超过 10 MB');
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    if (!png && !jpg && !webp)
        throw new Error('仅支持有效的 PNG、JPEG 或 WebP 图片');
    const extension = png ? 'png' : jpg ? 'jpg' : 'webp';
    return { bytes, name: `first-frame.${extension}`, mime: png ? 'image/png' : jpg ? 'image/jpeg' : 'image/webp' };
}
export function buildWorkflow(params: GenerationParams, uploadedName: string, taskId: string, tier: H3InstallationTier = 'standard'): ApiWorkflow {
    const lite = tier === 'lite' || tier === 'lite-audio';
    const p = validateGenerationParams(params, lite ? 20 : 4);
    const graph = structuredClone(lite ? liteTemplate : template) as ApiWorkflow;
    if (tier === 'lite-audio') {
        graph['4'] = {
            class_type: 'VAELoader',
            inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' }
        };
        graph['13'] = {
            class_type: 'VAEDecodeAudio',
            inputs: { samples: ['11', 0], vae: ['4', 0] }
        };
        graph['14'].inputs.audio = ['13', 0];
    }
    if (tier === 'balanced') graph['1'].inputs.unet_name = 'minimax_h3_fl2va_pruned_w6a8.safetensors';
    Object.assign(graph['6'].inputs, { prompt: p.prompt, width: p.width, height: p.height, length: p.frames });
    graph['7'].inputs.noise_seed = p.seed;
    graph['10'].inputs.steps = p.steps;
    if (p.mode === 'text') {
        delete graph['16'];
        delete graph['6'].inputs.first_frame;
    } else graph['16'].inputs.image = uploadedName;
    graph['15'].inputs.filename_prefix = `luckyx/${taskId}`;
    return graph;
}
export function safeOutputPath(filename: string, subfolder: string): boolean {
    return !!filename && !/[\\/:\x00]/.test(filename) && filename !== '.' && filename !== '..' && !/^[\\/]|[:\x00]/.test(subfolder) && !subfolder.split(/[\\/]/).some(s => s === '..');
}
export function mapHistoryOutputs(history: any, taskId: string, outputBaseUrl = ''): OutputFile[] {
    const result: OutputFile[] = [];
    for (const node of Object.values(history?.outputs ?? {}) as any[]) {
        for (const key of ['videos', 'images', 'gifs', 'audio']) {
            for (const item of (Array.isArray(node[key]) ? node[key] : [])) {
                const subfolder = item.subfolder ?? '';
                if (typeof item.filename !== 'string' || typeof subfolder !== 'string' || !safeOutputPath(item.filename, subfolder) || item.type !== 'output')
                    continue;
                if (!/\.(mp4|webm|mov)$/i.test(item.filename))
                    continue;
                if (result.some(o => o.filename === item.filename && o.subfolder === subfolder))
                    continue;
                result.push({ filename: item.filename, subfolder, type: 'output', url: `${outputBaseUrl}/api/media?taskId=${encodeURIComponent(taskId)}&index=${result.length}` });
            }
        }
    }
    return result;
}
export function isPromptRunning(queue: any, promptId: string): boolean { return (queue?.queue_running ?? []).some((entry: any) => Array.isArray(entry) && entry[1] === promptId); }
