import type { ParsedWorkflow } from './workflow-library';

export type WorkflowParameterKind =
    | 'prompt' | 'image' | 'video' | 'audio'
    | 'width' | 'height' | 'frames' | 'fps' | 'steps' | 'seed'
    | 'sampler' | 'scheduler'
    | 'diffusion-model' | 'checkpoint' | 'text-encoder' | 'vae' | 'lora' | 'lora-strength' | 'clip-projection' | 'model-patch';

export interface WorkflowParameterSlot {
    id: string;
    nodeId: string;
    classType: string;
    inputName: string;
    kind: WorkflowParameterKind;
    label: string;
    value: string | number | boolean;
    valueType: 'string' | 'integer' | 'number' | 'boolean';
    editable: boolean;
    constraints?: { min?: number; max?: number; step?: number; maxLength?: number; extensions?: string[] };
}

export interface WorkflowParameterAnalysis {
    format: 'api';
    slots: WorkflowParameterSlot[];
    features: {
        imageInput: boolean;
        videoInput: boolean;
        audioInput: boolean;
        audioPipeline: boolean;
        videoOutput: boolean;
        lora: boolean;
    };
    skipped: number;
}

type ApiNode = { class_type: string; inputs: Record<string, unknown> };
type Rule = { kind: WorkflowParameterKind; label: string; constraints?: WorkflowParameterSlot['constraints'] };

const classRules: Readonly<Record<string, Readonly<Record<string, Rule>>>> = {
    CLIPTextEncode: { text: { kind: 'prompt', label: '提示词', constraints: { maxLength: 10000 } } },
    MiniMaxH3ImageToVideo: {
        prompt: { kind: 'prompt', label: '提示词', constraints: { maxLength: 10000 } },
        width: { kind: 'width', label: '宽度', constraints: { min: 64, max: 4096, step: 8 } },
        height: { kind: 'height', label: '高度', constraints: { min: 64, max: 4096, step: 8 } },
        length: { kind: 'frames', label: '帧数', constraints: { min: 1, max: 4096, step: 1 } }
    },
    EmptyLatentImage: {
        width: { kind: 'width', label: '宽度', constraints: { min: 64, max: 4096, step: 8 } },
        height: { kind: 'height', label: '高度', constraints: { min: 64, max: 4096, step: 8 } }
    },
    EmptySD3LatentImage: {
        width: { kind: 'width', label: '宽度', constraints: { min: 64, max: 4096, step: 8 } },
        height: { kind: 'height', label: '高度', constraints: { min: 64, max: 4096, step: 8 } }
    },
    EmptyHunyuanLatentVideo: {
        width: { kind: 'width', label: '宽度', constraints: { min: 64, max: 4096, step: 8 } },
        height: { kind: 'height', label: '高度', constraints: { min: 64, max: 4096, step: 8 } },
        length: { kind: 'frames', label: '帧数', constraints: { min: 1, max: 4096, step: 1 } }
    },
    LoadImage: { image: { kind: 'image', label: '图片', constraints: { extensions: ['png', 'jpg', 'jpeg', 'webp'] } } },
    LoadVideo: {
        video: { kind: 'video', label: '视频', constraints: { extensions: ['mp4', 'webm', 'mov', 'mkv'] } },
        file: { kind: 'video', label: '视频', constraints: { extensions: ['mp4', 'webm', 'mov', 'mkv'] } }
    },
    VHS_LoadVideo: { video: { kind: 'video', label: '视频', constraints: { extensions: ['mp4', 'webm', 'mov', 'mkv'] } } },
    VHS_LoadVideoPath: { video: { kind: 'video', label: '视频', constraints: { extensions: ['mp4', 'webm', 'mov', 'mkv'] } } },
    LoadAudio: {
        audio: { kind: 'audio', label: '音频', constraints: { extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] } },
        file: { kind: 'audio', label: '音频', constraints: { extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] } }
    },
    VHS_LoadAudio: {
        audio: { kind: 'audio', label: '音频', constraints: { extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] } },
        file: { kind: 'audio', label: '音频', constraints: { extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] } }
    },
    RandomNoise: { noise_seed: { kind: 'seed', label: '随机种子', constraints: { min: 0, max: Number.MAX_SAFE_INTEGER, step: 1 } } },
    BasicScheduler: {
        scheduler: { kind: 'scheduler', label: '调度器', constraints: { maxLength: 128 } },
        steps: { kind: 'steps', label: '采样步数', constraints: { min: 1, max: 1000, step: 1 } }
    },
    KSampler: {
        seed: { kind: 'seed', label: '随机种子', constraints: { min: 0, max: Number.MAX_SAFE_INTEGER, step: 1 } },
        steps: { kind: 'steps', label: '采样步数', constraints: { min: 1, max: 1000, step: 1 } },
        sampler_name: { kind: 'sampler', label: '采样器', constraints: { maxLength: 128 } }, scheduler: { kind: 'scheduler', label: '调度器', constraints: { maxLength: 128 } }
    },
    KSamplerAdvanced: {
        noise_seed: { kind: 'seed', label: '随机种子', constraints: { min: 0, max: Number.MAX_SAFE_INTEGER, step: 1 } },
        steps: { kind: 'steps', label: '采样步数', constraints: { min: 1, max: 1000, step: 1 } },
        sampler_name: { kind: 'sampler', label: '采样器', constraints: { maxLength: 128 } }, scheduler: { kind: 'scheduler', label: '调度器', constraints: { maxLength: 128 } }
    },
    KSamplerSelect: { sampler_name: { kind: 'sampler', label: '采样器', constraints: { maxLength: 128 } } },
    CreateVideo: { fps: { kind: 'fps', label: '帧率', constraints: { min: 1, max: 240, step: 1 } } },
    UNETLoader: { unet_name: { kind: 'diffusion-model', label: '扩散模型' } },
    CheckpointLoaderSimple: { ckpt_name: { kind: 'checkpoint', label: 'Checkpoint' } },
    CLIPLoader: { clip_name: { kind: 'text-encoder', label: '文本编码器' } },
    VAELoader: { vae_name: { kind: 'vae', label: 'VAE' } },
    LoraLoader: {
        lora_name: { kind: 'lora', label: 'LoRA' },
        strength_model: { kind: 'lora-strength', label: 'LoRA 模型强度', constraints: { min: -10, max: 10, step: 0.01 } },
        strength_clip: { kind: 'lora-strength', label: 'LoRA 文本强度', constraints: { min: -10, max: 10, step: 0.01 } }
    },
    LoraLoaderModelOnly: {
        lora_name: { kind: 'lora', label: 'LoRA' },
        strength_model: { kind: 'lora-strength', label: 'LoRA 模型强度', constraints: { min: -10, max: 10, step: 0.01 } }
    },
    ClipProjApply: { projection: { kind: 'clip-projection', label: 'Clip Projection' } },
    ControlNetLoader: { control_net_name: { kind: 'model-patch', label: 'ControlNet 模型' } },
    ModelPatchLoader: { name: { kind: 'model-patch', label: '模型补丁' } }
};

function scalar(value: unknown): value is string | number | boolean {
    return typeof value === 'boolean' || typeof value === 'string' && value.length <= 100000 || typeof value === 'number' && Number.isFinite(value);
}

function valueType(value: string | number | boolean): WorkflowParameterSlot['valueType'] {
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    return typeof value === 'boolean' ? 'boolean' : 'string';
}

function apiNode(value: unknown): value is ApiNode {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && typeof (value as ApiNode).class_type === 'string'
        && !!(value as ApiNode).inputs && typeof (value as ApiNode).inputs === 'object' && !Array.isArray((value as ApiNode).inputs);
}

const dependencyKinds = new Set<WorkflowParameterKind>([
    'diffusion-model', 'checkpoint', 'text-encoder', 'vae', 'lora', 'clip-projection', 'model-patch'
]);
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** Model and LoRA selections are dependency information, not form-editable values. */
export function isEditableWorkflowKind(kind: WorkflowParameterKind): boolean {
    return !dependencyKinds.has(kind);
}

/** Analyze only validated API workflow data. Unknown nodes and connected inputs are intentionally ignored. */
export function analyzeWorkflowParameters(workflow: ParsedWorkflow): WorkflowParameterAnalysis {
    if (workflow.format !== 'api') throw new Error('参数面板目前只支持 API 工作流');
    const slots: WorkflowParameterSlot[] = [];
    let skipped = 0, audioPipeline = false, videoOutput = false;
    const audioOutputs = new Set(['VAEDecodeAudio', 'LoadAudio', 'VHS_LoadAudio', 'LoadAudioUpload', 'GetVideoComponents']);
    for (const [nodeId, value] of Object.entries(workflow.graph)) {
        if (!apiNode(value)) { skipped++; continue; }
        if (value.class_type === 'CreateVideo') {
            const connection = value.inputs.audio;
            if (Array.isArray(connection) && connection.length === 2
                && (typeof connection[0] === 'string' || typeof connection[0] === 'number')
                && Number.isSafeInteger(connection[1]) && (connection[1] as number) >= 0) {
                const source = workflow.graph[String(connection[0])];
                if (apiNode(source) && audioOutputs.has(source.class_type)) audioPipeline = true;
            }
        }
        if (['CreateVideo', 'SaveVideo', 'VHS_VideoCombine'].includes(value.class_type)) videoOutput = true;
        const rules = classRules[value.class_type];
        if (!rules) { skipped++; continue; }
        for (const [inputName, rule] of Object.entries(rules)) {
            const current = value.inputs[inputName];
            // Comfy API connections are [node id, output index]. They are graph topology,
            // not editable scalar parameters, so never expose them as form values.
            if (!scalar(current)) continue;
            slots.push({ id: `${nodeId}.${inputName}`, nodeId, classType: value.class_type, inputName,
                kind: rule.kind, label: rule.label, value: current,
                valueType: typeof current === 'number' && ['fps', 'lora-strength'].includes(rule.kind) ? 'number' : valueType(current),
                editable: isEditableWorkflowKind(rule.kind),
                ...(rule.constraints ? { constraints: { ...rule.constraints } } : {}) });
        }
    }
    return {
        format: 'api', slots, skipped,
        features: {
            imageInput: slots.some(slot => slot.kind === 'image'),
            videoInput: slots.some(slot => slot.kind === 'video'),
            audioInput: slots.some(slot => slot.kind === 'audio'),
            audioPipeline,
            videoOutput,
            lora: slots.some(slot => slot.kind === 'lora')
        }
    };
}

function sameAnalysis(expected: WorkflowParameterAnalysis, actual: WorkflowParameterAnalysis): boolean {
    if (expected.format !== 'api' || expected.slots.length !== actual.slots.length) return false;
    return expected.slots.every((slot, index) => {
        const current = actual.slots[index];
        return slot.id === current.id && slot.nodeId === current.nodeId && slot.inputName === current.inputName
            && slot.classType === current.classType && slot.kind === current.kind
            && slot.valueType === current.valueType && slot.editable === current.editable
            && Object.is(slot.value, current.value);
    });
}

function validateValue(slot: WorkflowParameterSlot, value: unknown): string | number | boolean {
    if (!slot.editable) throw new Error(`参数不可在表单修改：${slot.label}`);
    if (slot.valueType === 'string') {
        if (typeof value !== 'string') throw new Error(`${slot.label}必须是文本`);
        const maxLength = slot.constraints?.maxLength ?? (['image', 'video', 'audio'].includes(slot.kind) ? 4096 : 100000);
        if (value.length > maxLength || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error(`${slot.label}内容无效或过长`);
        return value;
    }
    if (slot.valueType === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`${slot.label}必须是开关值`);
        return value;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || slot.valueType === 'integer' && !Number.isSafeInteger(value)) throw new Error(`${slot.label}必须是有效数字`);
    const { min, max, step } = slot.constraints ?? {};
    if (min !== undefined && value < min || max !== undefined && value > max) throw new Error(`${slot.label}超出允许范围`);
    if (step !== undefined) {
        const units = (value - (min ?? 0)) / step;
        if (Math.abs(units - Math.round(units)) > 1e-8) throw new Error(`${slot.label}不符合步进要求`);
    }
    return value;
}

/** Apply only analyzed scalar form values to a clone; graph topology and dependencies stay unchanged. */
export function applyWorkflowParameterValues(workflow: ParsedWorkflow, analysis: WorkflowParameterAnalysis, values: unknown): ParsedWorkflow {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('工作流参数必须是对象');
    const actual = analyzeWorkflowParameters(workflow);
    if (!sameAnalysis(analysis, actual)) throw new Error('工作流参数分析已过期，请重新分析');
    const slots = new Map(actual.slots.map(slot => [slot.id, slot]));
    const changes = Object.entries(values as Record<string, unknown>);
    for (const [id] of changes) {
        if (forbiddenKeys.has(id)) throw new Error('工作流参数包含危险字段');
        if (!slots.has(id)) throw new Error('工作流参数包含未知字段：' + id);
    }
    const clone = structuredClone(workflow);
    for (const [id, candidate] of changes) {
        const slot = slots.get(id)!;
        if (forbiddenKeys.has(slot.nodeId) || forbiddenKeys.has(slot.inputName)) throw new Error('工作流参数指向危险字段');
        const node = clone.graph[slot.nodeId];
        if (!apiNode(node)) throw new Error('工作流节点已变化，请重新分析');
        node.inputs[slot.inputName] = validateValue(slot, candidate);
    }
    return clone;
}
