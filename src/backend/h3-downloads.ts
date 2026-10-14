import type { BootstrapFile, H3InstallationTier } from '../shared/bootstrap';
import { h3ModelSpecs } from '../shared/h3-installation';

// Fixed source revisions and LFS hashes inspected on 2026-10-14. No runtime repository HEAD updates.
const officialRevision = 'e5eb578a89295337b8ff433a035929ce0279e0b6';
const sources: Record<string, { repo: string; revision: string; file: string; size: number; sha256: string }> = {
    'minimax_h3_fl2va_pruned_int8_convrot.safetensors': { repo: 'Comfy-Org/MiniMax-H3', revision: officialRevision, file: 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors', size: 20970379616, sha256: 'e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a' },
    'minimax_h3_fl2va_pruned_w6a8.safetensors': { repo: 'Comfy-Org/MiniMax-H3', revision: officialRevision, file: 'diffusion_models/minimax_h3_fl2va_pruned_w6a8.safetensors', size: 15983746636, sha256: 'ac746a2e41628ab25afd44d2b22a7fab8d7e66cd07a01bf89ed9d74b0d3f0c35' },
    'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors': { repo: 'Comfy-Org/MiniMax-H3', revision: officialRevision, file: 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', size: 15687142551, sha256: '35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6' },
    'minimax_h3_video_vae_int8_convrot.safetensors': { repo: 'Comfy-Org/MiniMax-H3', revision: officialRevision, file: 'vae/minimax_h3_video_vae_int8_convrot.safetensors', size: 2811065184, sha256: '52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e' },
    'minimax_h3_audio_vae_fp32.safetensors': { repo: 'Comfy-Org/MiniMax-H3', revision: officialRevision, file: 'vae/minimax_h3_audio_vae_fp32.safetensors', size: 605254808, sha256: '8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48' },
    'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors': { repo: 'Comfy-Org/MiniMax-H3', revision: officialRevision, file: 'loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors', size: 1956192992, sha256: 'c396a9a06f58399e9df9754b18299818d84a2ddd371724ba48fe4a41221437dc' },
    'minimax_h3_fl2va_pruned_w4a8_mixed.safetensors': { repo: 'starsfriday/MiniMax-H3-w4a8', revision: '2a5ad5871296af3506fda7c5edd571612253cedb', file: 'minimax_h3_fl2va_pruned_w4a8_mixed.safetensors', size: 12540858008, sha256: '29d0a0e4be82dacdc4a5849bf756c2b32d34131f7a18f9aac754e16a2e215eb5' },
    'qwen3vl_4b_int8_convrot.safetensors': { repo: 'Stick9190/qwen3vl_4b_int8_convrot', revision: 'd9449494156acb47a84c68777d78bd8d9d5df97d', file: 'qwen3vl_4b_int8_convrot.safetensors', size: 5374169456, sha256: 'ebbb3efdf4a6e1b766e32f6dc4fa92af9530edede0968c070b3e604aeca413aa' },
    'mmh3-4b-ClipProj-v3-mlp.safetensors': { repo: 'NicoLab28/ClipProj-MiniMax-H3', revision: '2ebdbcdc27a29a9607efdb221a9afcb9a0cdd808', file: 'mmh3-4b-ClipProj-v3-mlp.safetensors', size: 503434368, sha256: 'feef06ef3b9aede3b1f3331b71eebbc873e21a867d73bcf40ea2c0b007270693' },
};
export const H3_COMMUNITY_NODES: BootstrapFile[] = [
    { id: 'clipproj', name: 'ComfyUI-ClipProj-0.1.13.zip', kind: 'node', relativePath: 'ComfyUI/custom_nodes/ComfyUI-ClipProj', archiveRoot: 'ComfyUI-ClipProj-c01ba8fb8f41b4f2094dbd0b185cdc238fb6134c', url: 'https://codeload.github.com/nicolab28/ComfyUI-ClipProj/zip/c01ba8fb8f41b4f2094dbd0b185cdc238fb6134c', sizeBytes: 1582000, sha256: '5db98923f741bafd1beb56649df23a0f7981055ab482b3c34da9778083e995df' },
    { id: 'spectrum', name: 'ComfyUI-Spectrum-MiniMax-H3-0.2.29.zip', kind: 'node', relativePath: 'ComfyUI/custom_nodes/ComfyUI-Spectrum-MiniMax-H3', archiveRoot: 'ComfyUI-Spectrum-MiniMax-H3-806fe498d574a726fecb8818917f00a4b993fd77', url: 'https://codeload.github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3/zip/806fe498d574a726fecb8818917f00a4b993fd77', sizeBytes: 636346, sha256: '949eb9410fd1dfcf812843af2c92bcdc81a7732cc30c60c9f8b4e244b106684f' },
];
export function getPinnedH3Files(tier: H3InstallationTier): BootstrapFile[] {
    if (tier === 'environment') return [];
    const models = h3ModelSpecs(tier).map(([folder, name], index) => {
        const source = sources[name];
        return { id: 'h3-' + index, name, kind: 'model' as const, relativePath: 'ComfyUI/models/' + folder + '/' + name, sizeBytes: source.size, sha256: source.sha256, url: `https://huggingface.co/${source.repo}/resolve/${source.revision}/${source.file}` };
    });
    return [...models, ...(tier === 'lite' ? structuredClone(H3_COMMUNITY_NODES) : [])];
}
export function isPinnedCommunityDownload(url: URL): boolean {
    return [...getPinnedH3Files('lite')].filter(file => !file.url.startsWith('https://huggingface.co/Comfy-Org/')).some(file => url.href === file.url);
}
