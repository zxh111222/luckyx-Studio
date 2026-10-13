/** Research only: these entries do not install models or register runnable Studio templates. */
export type RecommendationLevel = 'recommended' | 'conditional' | 'not-recommended' | 'unknown'
export interface ModelRecommendation {
  id: string
  name: string
  purpose: string
  description: string
  evidence: 'official-compatibility' | 'local-history'
  tutorialUrl: string
  repositoryUrl: string
  downloads: { name: string; folder: string; url: string }[]
  initial: { width: number; height: number; frames: number; note: string }
  conditions: string[]
  steps: string[]
  screenshotPath: string
  supportedInLauncher: boolean
  sourceNote: string
  /** Conservative product screening thresholds, NOT official minimum requirements. */
  screening: { preferredVramGb: number; preferredRamGb: number; trialVramGb: number; trialRamGb: number }
}

const wan21 = 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/blob/main/split_files'
const wan22 = 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/blob/main/split_files'
const h3 = 'https://huggingface.co/Comfy-Org/MiniMax-H3/blob/main'
export const modelRecommendations: readonly ModelRecommendation[] = [
  {
    id: 'wan22-ti2v-5b', name: 'Wan2.2 TI2V · 5B', purpose: '一个模型支持图生视频与文生视频',
    description: '兼顾图生与文生，适合从短片开始探索镜头运动。',
    evidence: 'official-compatibility', tutorialUrl: 'https://docs.comfy.org/tutorials/video/wan/wan2_2', repositoryUrl: 'https://github.com/Wan-Video/Wan2.2',
    downloads: [
      { name: 'wan2.2_ti2v_5B_fp16.safetensors', folder: 'diffusion_models', url: `${wan22}/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors` },
      { name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', folder: 'text_encoders', url: `${wan22}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` },
      { name: 'wan2.2_vae.safetensors', folder: 'vae', url: `${wan22}/vae/wan2.2_vae.safetensors` },
    ],
    initial: { width: 832, height: 480, frames: 81, note: '建议先短片试跑，再尝试官方 1280×704；低分辨率是本项目保守建议。' },
    conditions: ['使用 ComfyUI 原生 offload 与 Wan22ImageToVideoLatent 工作流', 'Wan 原版 720p 推理命令要求至少 24 GB，不能套用为 ComfyUI 的最低要求', '在原生界面验证；尚未接入 Studio 表单模板'],
    steps: ['按文件清单下载三个权重，放入对应 models 子目录', '在原生模板库搜索 Wan2.2 5B，核对模型、编码器和 VAE', '启用 Load Image 可做图生视频；保持原生 offload', '先用短片保守参数试跑，再检查输出文件和峰值显存'],
    screenshotPath: '/model-guides/wan22-ti2v-5b-official.jpg', supportedInLauncher: false,
    sourceNote: 'ComfyUI 官方建议使用原生内存卸载，5B 可适配 8 GB 显存；分辨率和帧数会影响实际占用。',
    screening: { preferredVramGb: 16, preferredRamGb: 32, trialVramGb: 8, trialRamGb: 32 },
  },
  {
    id: 'wan21-t2v-13b', name: 'Wan2.1 T2V · 1.3B', purpose: '较轻量的文生视频备选，不是图生视频模型',
    description: '从一段文字生成画面，适合轻量创作与提示词练习。',
    evidence: 'official-compatibility', tutorialUrl: 'https://docs.comfy.org/tutorials/video/wan/wan-video', repositoryUrl: 'https://github.com/Wan-Video/Wan2.1',
    downloads: [
      { name: 'wan2.1_t2v_1.3B_fp16.safetensors', folder: 'diffusion_models', url: `${wan21}/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors` },
      { name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', folder: 'text_encoders', url: `${wan21}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` },
      { name: 'wan_2.1_vae.safetensors', folder: 'vae', url: `${wan21}/vae/wan_2.1_vae.safetensors` },
    ],
    initial: { width: 832, height: 480, frames: 81, note: '优先 480p；官方指出 1.3B 的 720p 结果较不稳定。' },
    conditions: ['使用原生 Wan 2.1 Text to Video 模板', '不需为这个 T2V 模板另下载 CLIP Vision', '尚未接入 Studio 表单模板'],
    steps: ['下载 1.3B 模型、UMT5 编码器和 Wan 2.1 VAE', '在原生界面加载 Wan 2.1 Text to Video 模板', '核对三类加载节点，填写提示词', '先生成 480p 短片并检查播放和峰值显存'],
    screenshotPath: '/model-guides/wan21-t2v-13b-official.jpg', supportedInLauncher: false,
    sourceNote: 'Wan 官方公布 1.3B 文生视频显存需求约 8.19 GB，建议使用 480p。',
    screening: { preferredVramGb: 12, preferredRamGb: 24, trialVramGb: 9, trialRamGb: 16 },
  },
  {
    id: 'ltx-video-2b-095', name: 'LTX-Video · 2B 0.9.5', purpose: '图生视频与文生视频 · 经典轻量版本',
    description: '适合尝试低分辨率预览，使用详细提示词控制画面。',
    evidence: 'official-compatibility', tutorialUrl: 'https://comfyanonymous.github.io/ComfyUI_examples/ltxv/', repositoryUrl: 'https://huggingface.co/Lightricks/LTX-Video',
    downloads: [
      { name: 'ltx-video-2b-v0.9.5.safetensors', folder: 'checkpoints', url: 'https://huggingface.co/Lightricks/LTX-Video/blob/main/ltx-video-2b-v0.9.5.safetensors' },
      { name: 't5xxl_fp16.safetensors', folder: 'text_encoders', url: 'https://huggingface.co/Comfy-Org/mochi_preview_repackaged/blob/main/split_files/text_encoders/t5xxl_fp16.safetensors' },
    ],
    initial: { width: 768, height: 512, frames: 97, note: '保守试跑建议：尺寸为 32 的倍数、帧数 8k+1；使用详细英文提示词。' },
    conditions: ['按 0.9.5 原生官方示例，不混用 LTX-2/2.5 文件', '检查 LTXVConditioning、LTXVScheduler、LTXVPreprocess 节点', '示例默认 WEBP 输出；要 MP4 需另接视频输出节点', 'T5 编码器也占内存；16 GB 仅为待验证选择'],
    steps: ['将 0.9.5 模型放入 checkpoints，T5 编码器放入 text_encoders', '加载教程中的简单图生视频 JSON，核对 LTXV 原生节点', '上传首帧、填写详细英文提示词，以保守参数试跑', '示例先输出动画 WEBP；需要 MP4 时另接视频输出节点并验收'],
    screenshotPath: '/model-guides/ltx-video-2b-095-official.jpg', supportedInLauncher: false,
    sourceNote: '此推荐依据官方 2B 示例及保守配置筛选，实际占用还取决于 T5 编码器、尺寸和帧数。',
    screening: { preferredVramGb: 24, preferredRamGb: 48, trialVramGb: 12, trialRamGb: 32 },
  },
  {
    id: 'minimax-h3-existing', name: 'MiniMax H3 · 音画同步', purpose: '图生视频、文生视频与同步音轨',
    description: '画面与声音一起生成，可直接使用 H3 创作工作台。',
    evidence: 'local-history', tutorialUrl: 'https://docs.comfy.org/tutorials/video/minimax/minimax-h3', repositoryUrl: 'https://github.com/MiniMax-AI/MiniMax-H3',
    downloads: [
      { name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', folder: 'diffusion_models', url: `${h3}/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors` },
      { name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', folder: 'text_encoders', url: `${h3}/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` },
      { name: 'minimax_h3_video_vae_int8_convrot.safetensors', folder: 'vae', url: `${h3}/vae/minimax_h3_video_vae_int8_convrot.safetensors` },
      { name: 'minimax_h3_audio_vae_fp32.safetensors', folder: 'vae', url: `${h3}/vae/minimax_h3_audio_vae_fp32.safetensors` },
      { name: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors', folder: 'loras', url: `${h3}/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors` },
    ],
    initial: { width: 864, height: 480, frames: 124, note: '启动器默认短片参数：24 fps，约 5.17 秒，4 步 Turbo。' },
    conditions: ['复用现有独立 Python、CUDA 13.0 PyTorch 和原生 H3 节点', '帧数为 17k+5，尺寸取 32 的倍数', '本地基础模型不包含托管 2K 完整流程'],
    steps: ['连接现有 MiniMax-H3 安装根目录并检查依赖', '使用默认参数上传图片并填写提示词', '生成后验证 MP4 播放、音轨和导出'],
    screenshotPath: '/model-guides/minimax-h3-existing-official.jpg', supportedInLauncher: true,
    sourceNote: '音视频联合生成，需要匹配的 H3 节点、编码器、双 VAE 与 Turbo LoRA；安装后请检查依赖。',
    screening: { preferredVramGb: 16, preferredRamGb: 32, trialVramGb: 12, trialRamGb: 32 },
  },
]

/** Pure hardware screening; no installation state, template readiness, or performance guarantee. */
export function rankModelRecommendations(vramMb: number, ramGb: number): (ModelRecommendation & { level: RecommendationLevel; levelLabel: string })[] {
  const known = Number.isFinite(vramMb) && Number.isFinite(ramGb) && vramMb > 0 && ramGb > 0
  return modelRecommendations.map(model => {
    // Driver/OS reporting can omit a small reserved amount: 16376 MiB is a 16 GB class card.
    // These tolerances do not promote a 14 GB GPU or 16 GB RAM machine to the next class.
    const gpuGb = vramMb / 1024 + 0.05
    const availableRamClassGb = ramGb + 1
    const thresholds = model.screening
    const level: RecommendationLevel = !known ? 'unknown'
      : gpuGb >= thresholds.preferredVramGb && availableRamClassGb >= thresholds.preferredRamGb ? 'recommended'
      : gpuGb >= thresholds.trialVramGb && availableRamClassGb >= thresholds.trialRamGb ? 'conditional' : 'not-recommended'
    const levelLabel = { recommended: '推荐尝试', conditional: '建议降低参数试用', 'not-recommended': '当前配置暂不推荐', unknown: '等待设备检测' }[level]
    return { ...model, level, levelLabel }
  })
}

