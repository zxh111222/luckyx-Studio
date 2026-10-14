import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { recommendH3Installation, h3TierDefaults, h3TierLaunchArgs, h3ModelSpecs } from '../src/shared/h3-installation';
import { getPinnedH3Files } from '../src/backend/h3-downloads';
import { assertOfficialDownloadUrl } from '../src/backend/bootstrap';
import { getH3Runtime } from '../src/backend/h3-runtime';
import { buildWorkflow, validateGenerationParams } from '../src/shared/workflow';

const hardware = { gpuName: 'NVIDIA GeForce RTX 4060', vramMb: 8192, ramGb: 16, driver: '590.01' };
test('从8GB按显存与可用RAM联合分档，标称32/48GB容许Windows31/47GB读数', () => {
    for (const [vramMb, ramGb, expected] of [[8192, 16, 'lite'], [12288, 32, 'lite'], [16376, 31, 'balanced'], [24000, 31, 'balanced'], [24000, 47, 'standard'], [32768, 64, 'standard'], [49152, 16, 'lite'], [16384, 30, 'lite']] as const) {
        const result = recommendH3Installation({ ...hardware, vramMb, ramGb });
        assert.equal(result.recommendation.tier, expected); assert.deepEqual(result.hardwareIssues, []);
    }
});
test('低于8GB、RAM不足、未知、非RTX与AMD不强行安装H3；基础环境可独立选', () => {
    for (const patch of [{ vramMb: 6144 }, { vramMb: NaN }, { ramGb: 8 }, { gpuName: '未知' }, { gpuName: 'AMD Radeon RX 7900 XTX', vramMb: 24000 }, { gpuName: 'NVIDIA GeForce GTX 1080 Ti' }]) {
        const result = recommendH3Installation({ ...hardware, ...patch });
        assert.equal(result.recommendation.tier, 'environment'); assert.ok(result.hardwareIssues.length); assert.equal(result.recommendation.modelNames.length, 0);
    }
    assert.deepEqual(recommendH3Installation({ ...hardware, ramGb: 8, vramMb: 6144 }, 'environment').hardwareIssues, []);
});
test('档位真实选择不同文件与节点；Lite没有32B编码器、音频VAE或TurboLoRA', () => {
    const lite = getPinnedH3Files('lite'), balanced = getPinnedH3Files('balanced'), standard = getPinnedH3Files('standard');
    assert.equal(lite.filter(file => file.kind === 'model').length, 4); assert.equal(lite.filter(file => file.kind === 'node').length, 2);
    assert.ok(!lite.some(file => /32b|audio_vae|turbo/.test(file.name)));
    assert.ok(balanced.some(file => file.name.includes('w6a8'))); assert.ok(standard.some(file => file.name.includes('pruned_int8')));
    assert.ok(lite.reduce((sum, file) => sum + file.sizeBytes, 0) < balanced.reduce((sum, file) => sum + file.sizeBytes, 0));
    assert.ok(balanced.reduce((sum, file) => sum + file.sizeBytes, 0) < standard.reduce((sum, file) => sum + file.sizeBytes, 0));
    for (const file of [...lite, ...balanced, ...standard]) { assert.match(file.sha256, /^[a-f0-9]{64}$/); assertOfficialDownloadUrl(file.url); assert.ok(file.sizeBytes > 0); }
});
test('社区下载仅允许核对过的固定revision，不能换仓库或main；官方校验规则仍生效', () => {
    for (const file of getPinnedH3Files('lite').filter(file => !file.url.includes('Comfy-Org'))) {
        assertOfficialDownloadUrl(file.url);
        assert.throws(() => assertOfficialDownloadUrl(file.url.replace(/[a-f0-9]{40}/, 'main')));
        assert.throws(() => assertOfficialDownloadUrl(file.url.replace(/[a-f0-9]{40}/, '0'.repeat(40))));
    }
    assert.throws(() => assertOfficialDownloadUrl('https://codeload.github.com/other/nodes/zip/' + 'a'.repeat(40)));
});
test('所有默认尺寸与帧数符合H3网格，低档减尺寸时长并加载安全固定启动参数', () => {
    for (const tier of ['lite', 'balanced', 'standard'] as const) {
        const defaults = h3TierDefaults(tier); assert.equal(defaults.width % 32, 0); assert.equal(defaults.height % 32, 0); assert.equal((defaults.frames - 5) % 17, 0);
        validateGenerationParams({ ...defaults, templateId: 'h3-i2v', prompt: 'scene', seed: 0 }, defaults.steps);
    }
    assert.deepEqual(h3TierLaunchArgs('lite'), ['--lowvram', '--fp16-vae']); assert.ok(!h3TierLaunchArgs('lite').includes('--cpu-vae'));
    assert.equal(h3TierDefaults('lite').audio, false); assert.ok(h3TierDefaults('balanced').frames < h3TierDefaults('standard').frames);
});
test('Lite API图匹配W4A8+4B+投影+Spectrum，20步Euler视频无音频；文生移除图片', () => {
    const params = { templateId: 'h3-i2v', prompt: '一只红球滚动', seed: 42, ...h3TierDefaults('lite') };
    const image = buildWorkflow(params, 'input.png', 'lite-image', 'lite');
    assert.match(String(image['1'].inputs.unet_name), /w4a8/); assert.equal(image['2'].inputs.type, 'krea2');
    assert.equal(image['17'].class_type, 'ClipProjApply'); assert.deepEqual(image['6'].inputs.clip, ['17', 0]);
    assert.equal(image['20'].class_type, 'SpectrumApplyMiniMaxH3'); assert.equal(image['20'].inputs.history_storage, 'system_ram');
    assert.deepEqual(image['8'].inputs.model, ['20', 0]); assert.equal(image['9'].inputs.sampler_name, 'euler'); assert.equal(image['10'].inputs.steps, 20);
    assert.ok(!image['14'].inputs.audio); assert.ok(!Object.values(image).some(node => node.class_type === 'VAEDecodeAudio' || node.class_type === 'LoraLoaderModelOnly'));
    const text = buildWorkflow({ ...params, mode: 'text' }, '', 'lite-text', 'lite'); assert.ok(!text['16']); assert.ok(!text['6'].inputs.first_frame);
    assert.throws(() => buildWorkflow({ ...params, steps: 4 }, '', 'bad', 'lite'), /20 步/);
});
test('均衡图仅换正确扩散checkpoint，旧INT8四步图与含音频任务兼容', () => {
    for (const tier of ['balanced', 'standard'] as const) {
        const graph = buildWorkflow({ ...h3TierDefaults(tier), templateId: 'h3-i2v', prompt: 'scene', seed: 0 }, 'image.png', 'task', tier);
        assert.equal(graph['1'].inputs.unet_name, h3ModelSpecs(tier)[0][1]); assert.ok(graph['14'].inputs.audio); assert.equal(graph['10'].inputs.steps, 4);
    }
});
test('安装标识只接受已知档位，忽略任意launchArgs；未标记已有INT8环境保持原模板', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luckyx-h3-runtime-')); t.after(async () => { assert.ok(path.basename(root).startsWith('luckyx-h3-runtime-')); await fs.rm(root, { recursive: true, force: true }); });
    const models = path.join(root, 'ComfyUI/models'); await fs.mkdir(path.join(models, 'diffusion_models'), { recursive: true });
    await fs.writeFile(path.join(models, 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors'), 'old-model');
    assert.equal((await getH3Runtime(root, models)).tier, 'standard');
    await fs.writeFile(path.join(root, 'luckyx-managed.json'), JSON.stringify({ app: 'luckyx. Studio', installationTier: 'lite', launchArgs: ['--listen', '0.0.0.0'] }));
    assert.deepEqual((await getH3Runtime(root, models)).launchArgs, ['--lowvram', '--fp16-vae']);
    await fs.writeFile(path.join(root, 'luckyx-managed.json'), JSON.stringify({ app: 'other', installationTier: 'lite' }));
    assert.equal((await getH3Runtime(root, models)).tier, 'standard');
});
