import style from '../backend/workflows/h3-video-style.json';
import character from '../backend/workflows/h3-video-inpaint.json';
import background from '../backend/workflows/h3-video-background.json';
import type { VideoRecipeEntry, VideoRecipeModel } from './contracts';
import type { ApiWorkflow } from './workflow';
export interface VideoRecipeDefinition extends Omit<VideoRecipeEntry, 'status' | 'issues' | 'missingNodes' | 'missingModels'> {
    graph: ApiWorkflow;
}
const models: VideoRecipeModel[] = [
    ['diffusion_models', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
    ['text_encoders', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],
    ['vae', 'minimax_h3_video_vae_int8_convrot.safetensors'],
    ['vae', 'minimax_h3_audio_vae_fp32.safetensors'],
    ['model_patches', 'minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors'],
].map(([folder, name]) => ({ folder, name, url: `https://huggingface.co/Comfy-Org/MiniMax-H3/blob/main/${folder}/${name}` }));
const sourceUrl = 'https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet';
const sharedSteps = ['检查下列模型和原生节点依赖；复用已有 H3 权重，另准备 FunUnion patch。', '创建本地工作流副本，在原生编辑器上传原视频；建议先用约 5 秒、24 fps 的短片。', '默认输出 864×480、124 帧、24 fps，20 步；原视频更长会截取，更短会保持末帧。'];
const audioStep = '默认保留原视频音轨；无原音时断开 CreateVideo 的 audio，生成新音轨可改接 VAEDecodeAudio（13）的输出 0。';
export const videoRecipeDefinitions: readonly VideoRecipeDefinition[] = [
    { id: 'h3-video-style', name: '视频风格转换 · H3 试用', description: '重绘整体画面风格，用原视频边缘引导构图与动作。', inputs: ['原视频', '目标风格提示词'], steps: [...sharedSteps, '改写目标风格提示词；Canny 提供边缘引导，全白 SolidMask 允许整幅重绘，不能保证原视频逐帧不变。', audioStep, '核对依赖和参数后，在原生编辑器手动运行。'], sourceUrl, models, graph: style as ApiWorkflow },
    { id: 'h3-video-character', name: '局部换人物 · H3 试用', description: '用逐帧人物遮罩改造局部角色，背景区域保持受保护。', inputs: ['原视频', '逐帧黑白人物蒙版视频', '目标人物提示词'], steps: [...sharedSteps, '上传与原片帧率、帧数、时间对齐的黑白蒙版视频：白色人物区域重绘，黑色背景保留。', '改写人物提示词；本图不使用原人物边缘，避免阻碍角色变化。固定人物身份需要另行接入参考权重。', audioStep, '先检查蒙版覆盖，再在原生编辑器手动运行；本功能不自动生成蒙版。'], sourceUrl, models, graph: character as ApiWorkflow },
    { id: 'h3-video-background', name: '更换背景 · H3 试用', description: '用逐帧背景遮罩重绘场景，保护人物和前景区域。', inputs: ['原视频', '逐帧黑白背景蒙版视频', '目标背景提示词'], steps: [...sharedSteps, '上传与原片对齐的黑白蒙版视频：白色背景重绘，黑色人物和前景保留。', '改写背景提示词；检查人物边缘、遮挡和逐帧蒙版，避免前景被误重绘。', audioStep, '核对蒙版和输入材料后，在原生编辑器手动运行；本功能不自动抠像。'], sourceUrl, models, graph: background as ApiWorkflow },
];
export const MODEL_LOADER_FIELDS: Readonly<Record<string, string>> = { UNETLoader: 'unet_name', CLIPLoader: 'clip_name', VAELoader: 'vae_name', LoraLoaderModelOnly: 'lora_name', ModelPatchLoader: 'name', CheckpointLoaderSimple: 'ckpt_name', CLIPVisionLoader: 'clip_name' };

