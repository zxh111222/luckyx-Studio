import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflowJson, type ParsedWorkflow } from '../src/shared/workflow-library';
import { analyzeWorkflowParameters } from '../src/shared/workflow-parameters';

function analyze(graph: Record<string, unknown>) { return analyzeWorkflowParameters(parseWorkflowJson(JSON.stringify(graph))); }
function slotMap(graph: Record<string, unknown>) { return new Map(analyze(graph).slots.map(slot => [slot.id, slot])); }

test('典型H3 API图识别创作参数、输入、模型、LoRA和音频管线', () => {
  const graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'h3.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen.safetensors', type: 'minimax' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'video-vae.safetensors' } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: 'audio-vae.safetensors' } },
    '5': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'turbo.safetensors', strength_model: 0.8 } },
    '6': { class_type: 'MiniMaxH3ImageToVideo', inputs: { clip: ['2', 0], vae: ['3', 0], prompt: '雨夜街道，远处雷声', width: 864, height: 480, length: 124, first_frame: ['16', 0] } },
    '7': { class_type: 'RandomNoise', inputs: { noise_seed: 42 } },
    '9': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '10': { class_type: 'BasicScheduler', inputs: { model: ['5', 0], scheduler: 'simple', steps: 4 } },
    '13': { class_type: 'VAEDecodeAudio', inputs: { samples: ['11', 0], vae: ['4', 0] } },
    '14': { class_type: 'CreateVideo', inputs: { images: ['12', 0], audio: ['13', 0], fps: 24 } },
    '16': { class_type: 'LoadImage', inputs: { image: 'first.webp' } },
    '17': { class_type: 'LoadVideo', inputs: { video: 'source.mp4' } },
    '18': { class_type: 'LoadAudio', inputs: { audio: 'guide.wav' } },
    '19': { class_type: 'ClipProjApply', inputs: { projection: 'clip-proj.safetensors', clip: ['2', 0] } },
    '20': { class_type: 'ModelPatchLoader', inputs: { name: 'fun-control.safetensors' } }
  };
  const result = analyze(graph), slots = new Map(result.slots.map(slot => [slot.id, slot]));
  for (const id of ['6.prompt', '6.width', '6.height', '6.length', '7.noise_seed', '9.sampler_name', '10.scheduler', '10.steps', '14.fps', '16.image', '17.video', '18.audio', '1.unet_name', '2.clip_name', '3.vae_name', '4.vae_name', '5.lora_name', '5.strength_model', '19.projection', '20.name']) assert.ok(slots.has(id), `缺少 ${id}`);
  assert.equal(slots.get('6.length')!.kind, 'frames'); assert.equal(slots.get('7.noise_seed')!.valueType, 'integer'); assert.equal(slots.get('5.strength_model')!.valueType, 'number');
  assert.deepEqual(result.features, { imageInput: true, videoInput: true, audioInput: true, audioPipeline: true, videoOutput: true, lora: true });
  assert.ok(!slots.has('6.clip')); assert.ok(!slots.has('6.vae')); assert.ok(!slots.has('14.audio'), '节点连接不能作为可编辑标量暴露');
});

test('UI工作流明确拒绝自动参数面板，不从widgets_values猜测含义', () => {
  const ui = parseWorkflowJson(JSON.stringify({ version: 0.4, nodes: [{ id: 1, type: 'KSampler', widgets_values: [123, 20, 8, 'euler'] }], links: [] }));
  assert.equal(ui.format, 'ui'); assert.throws(() => analyzeWorkflowParameters(ui), /只支持 API 工作流/);
});

test('未知节点保守跳过，已知节点中的连线和值仍各自正确处理', () => {
  const result = analyze({
    unknown: { class_type: 'ThirdPartyMagic', inputs: { prompt: '不得猜成提示词', width: 1024, seed: 9 } },
    text: { class_type: 'CLIPTextEncode', inputs: { text: '可识别提示词', clip: ['loader', 0] } },
    sampler: { class_type: 'KSampler', inputs: { seed: ['seed-node', 0], steps: 20, sampler_name: 'euler', scheduler: 'normal' } }
  });
  assert.equal(result.skipped, 1); assert.equal(result.slots.find(slot => slot.id === 'text.text')?.value, '可识别提示词');
  assert.ok(!result.slots.some(slot => slot.nodeId === 'unknown')); assert.ok(!result.slots.some(slot => slot.id === 'sampler.seed'));
  assert.deepEqual(result.slots.filter(slot => slot.nodeId === 'sampler').map(slot => slot.kind).sort(), ['sampler', 'scheduler', 'steps']);
});

test('模型槽位只接受已知加载节点的标量，不把路径、连接或任意同名字段误识别', () => {
  const slots = slotMap({
    checkpoint: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'models/checkpoints/base.safetensors' } },
    lora: { class_type: 'LoraLoader', inputs: { lora_name: 'styles/look.safetensors', strength_model: -0.5, strength_clip: 1.25, model: ['checkpoint', 0], clip: ['checkpoint', 1] } },
    control: { class_type: 'ControlNetLoader', inputs: { control_net_name: 'control.safetensors' } },
    fake: { class_type: 'UnknownLoader', inputs: { lora_name: 'evil.safetensors', vae_name: 'evil-vae.safetensors' } },
    connectedVae: { class_type: 'VAELoader', inputs: { vae_name: ['chooser', 0] } }
  });
  assert.equal(slots.get('checkpoint.ckpt_name')?.kind, 'checkpoint'); assert.equal(slots.get('lora.lora_name')?.kind, 'lora');
  assert.equal(slots.get('control.control_net_name')?.kind, 'model-patch'); assert.equal(slots.get('lora.strength_clip')?.constraints?.max, 10);
  assert.ok(!slots.has('fake.lora_name')); assert.ok(!slots.has('connectedVae.vae_name'));
});

test('音频管线只认指向现有音频输出节点的合法连接', () => {
  assert.equal(analyze({ decode: { class_type: 'VAEDecodeAudio', inputs: {} }, video: { class_type: 'CreateVideo', inputs: { audio: ['decode', 0], fps: 24 } } }).features.audioPipeline, true);
  for (const audio of [['missing', 0], ['decode'], ['decode', -1], ['decode', 1.5], 'decode']) {
    const result = analyze({ decode: { class_type: 'VAEDecode', inputs: {} }, video: { class_type: 'CreateVideo', inputs: { audio, fps: 24 } } });
    assert.equal(result.features.audioPipeline, false, `不合法音频连接：${JSON.stringify(audio)}`);
  }
});

test('危险结构由解析器拒绝，非有限值与过长文本不会成为参数槽位', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) assert.throws(() => parseWorkflowJson(`{"1":{"class_type":"KSampler","inputs":{"${key}":1,"steps":20}}}`), /不安全/);
  const direct: ParsedWorkflow = { format: 'api', nodeCount: 3, graph: {
    nan: { class_type: 'KSampler', inputs: { seed: Number.NaN, steps: Number.POSITIVE_INFINITY } },
    prompt: { class_type: 'CLIPTextEncode', inputs: { text: '字'.repeat(100001) } },
    valid: { class_type: 'KSampler', inputs: { seed: 0, steps: 1, sampler_name: 'euler', scheduler: 'normal' } }
  } };
  const result = analyzeWorkflowParameters(direct); assert.ok(!result.slots.some(slot => ['nan', 'prompt'].includes(slot.nodeId))); assert.equal(result.slots.filter(slot => slot.nodeId === 'valid').length, 4);
});

test('数值槽位携带边界与步进供界面校验，异常标量不会失去约束', () => {
  const slots = slotMap({ h3: { class_type: 'MiniMaxH3ImageToVideo', inputs: { prompt: '', width: -32, height: 99999, length: 0 } }, sampler: { class_type: 'KSampler', inputs: { seed: -1, steps: 0, sampler_name: '', scheduler: '' } }, video: { class_type: 'CreateVideo', inputs: { fps: 0 } } });
  assert.deepEqual(slots.get('h3.width')?.constraints, { min: 64, max: 4096, step: 8 }); assert.deepEqual(slots.get('h3.length')?.constraints, { min: 1, max: 4096, step: 1 });
  assert.equal(slots.get('sampler.seed')?.constraints?.min, 0); assert.equal(slots.get('sampler.steps')?.constraints?.min, 1); assert.equal(slots.get('video.fps')?.constraints?.max, 240);
});
