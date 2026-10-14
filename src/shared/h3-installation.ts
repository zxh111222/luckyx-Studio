import type { BootstrapHardware, H3InstallationRecommendation, H3InstallationTier } from './bootstrap';

export const H3_STANDARD_MODELS = [
    ['diffusion_models', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
    ['text_encoders', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],
    ['vae', 'minimax_h3_video_vae_int8_convrot.safetensors'],
    ['vae', 'minimax_h3_audio_vae_fp32.safetensors'],
    ['loras', 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors'],
] as const;
export const H3_BALANCED_MODELS = H3_STANDARD_MODELS.map(([folder, name], index) => [folder, index === 0 ? 'minimax_h3_fl2va_pruned_w6a8.safetensors' : name] as const);
export const H3_LITE_MODELS = [
    ['diffusion_models', 'minimax_h3_fl2va_pruned_w4a8_mixed.safetensors'],
    ['text_encoders', 'qwen3vl_4b_int8_convrot.safetensors'],
    ['vae', 'minimax_h3_video_vae_int8_convrot.safetensors'],
    ['clip_projections', 'mmh3-4b-ClipProj-v3-mlp.safetensors'],
] as const;
export function h3ModelSpecs(tier: H3InstallationTier) {
    return tier === 'lite' ? H3_LITE_MODELS : tier === 'balanced' ? H3_BALANCED_MODELS : H3_STANDARD_MODELS;
}
export const H3_LITE_NODES = ['ClipProjApply', 'SpectrumApplyMiniMaxH3'];
export function h3TierDefaults(tier: H3InstallationTier): H3InstallationRecommendation['defaults'] {
    if (tier === 'lite') return { width: 608, height: 352, frames: 56, steps: 20, fps: 24, audio: false };
    if (tier === 'balanced') return { width: 768, height: 448, frames: 90, steps: 4, fps: 24, audio: true };
    return { width: 864, height: 480, frames: 124, steps: 4, fps: 24, audio: true };
}
export function h3TierLaunchArgs(tier: H3InstallationTier): string[] {
    if (tier === 'lite') return ['--lowvram', '--fp16-vae'];
    if (tier === 'balanced') return ['--lowvram'];
    return [];
}
export function recommendH3Installation(hardware: BootstrapHardware, profile: 'environment' | 'h3' = 'h3'): { recommendation: H3InstallationRecommendation; hardwareIssues: string[] } {
    const hardwareIssues: string[] = [];
    const nvidiaRtx = /RTX\s*(?:[2-9]\d{3}|A\d+)|RTX PRO/i.test(hardware.gpuName);
    const legacyNvidia = /(?:GTX\s*(?:9\d{2}|10\d{2})|Quadro\s*[MP]\d+)/i.test(hardware.gpuName);
    if (!nvidiaRtx && !(profile === 'environment' && legacyNvidia)) hardwareIssues.push('H3 自动安装需要 NVIDIA RTX 20 系列或更新显卡；支持的旧款 GTX / Quadro 可选择仅安装基础环境，其他显卡请使用手动教程');
    if (profile === 'h3' && (!Number.isFinite(hardware.vramMb) || hardware.vramMb < 7800)) hardwareIssues.push('H3 自适应安装从 8 GB 显存开始；显存不足或未检测到时可先安装基础环境');
    if (profile === 'h3' && (!Number.isFinite(hardware.ramGb) || hardware.ramGb < 16)) hardwareIssues.push('H3 条件试用至少需要 16 GB 系统内存；当前配置可先安装基础环境');
    let tier: H3InstallationTier = 'environment';
    if (profile === 'h3' && !hardwareIssues.length) {
        // Windows reports usable RAM, so a nominal 32/48 GB system can report 31/47 GB.
        tier = hardware.vramMb >= 24000 && hardware.ramGb >= 47 ? 'standard' : hardware.vramMb >= 16000 && hardware.ramGb >= 31 ? 'balanced' : 'lite';
    }
    const labels = { environment: 'ComfyUI 基础环境', lite: 'H3 Lite · W4A8 + 4B 编码器', balanced: 'H3 均衡 · 官方 W6A8', standard: 'H3 标准 · 官方 INT8' };
    const reason = tier === 'environment' ? profile === 'environment' ? '仅安装运行环境，稍后自行选择模型' : '当前硬件不符合 H3 自动安装条件' : tier === 'lite' ? '按显存和系统内存选择较小的社区权重与编码器，减少内存负担' : tier === 'balanced' ? '选择较小的官方扩散权重，保留原生音频和 32B 编码器' : '显存与系统内存较充足，使用官方 INT8 原生音视频方案';
    const warnings = tier === 'environment' ? [] : ['按硬件估算的试用配置，尚未在此电脑验证生成；速度取决于显卡、内存、驱动和可用空间'];
    if (tier === 'lite') warnings.push('社区 Lite 使用 ClipProj / Spectrum 节点，画质和提示词理解可能降低；当前方案仅生成视频，不含音频', '8 GB 显存需要 CPU 卸载，首次先用短片试跑；建议 32 GB 内存并关闭占用显存的其他应用');
    return { recommendation: { tier, label: labels[tier], source: tier === 'lite' ? 'community' : 'official', reason, warnings, modelNames: tier === 'environment' ? [] : h3ModelSpecs(tier).map(([, name]) => name), requiredNodes: tier === 'lite' ? [...H3_LITE_NODES] : [], launchArgs: h3TierLaunchArgs(tier), defaults: h3TierDefaults(tier) }, hardwareIssues };
}
