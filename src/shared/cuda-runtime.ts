import type { BootstrapHardware, BootstrapRuntime } from './bootstrap'

export const NVIDIA_DRIVER_URL = 'https://www.nvidia.com/en-us/drivers/'
export function parseNvidiaCudaVersion(output: string): string | undefined {
  return /CUDA Version:\s*(\d+\.\d+)/i.exec(output)?.[1]
}
function version(value?: string): number[] | undefined {
  if (!value || !/^\d+(?:\.\d+)*$/.test(value)) return undefined
  return value.split('.').map(Number)
}
function atLeast(actual: number[], major: number, minor = 0) {
  return actual[0] > major || actual[0] === major && (actual[1] ?? 0) >= minor
}
/** Follow the pinned ComfyUI 0.39 portable support matrix, not Toolkit filenames. */
export function selectCudaRuntime(hardware: BootstrapHardware): { runtime: BootstrapRuntime; hardwareIssues: string[] } {
  const legacy = /(?:GTX\s*(?:9\d{2}|10\d{2})|Quadro\s*[MP]\d+)/i.test(hardware.gpuName)
  const rtx = /RTX\s*(?:[2-9]\d{3}|A\d+)|RTX PRO/i.test(hardware.gpuName)
  const driver = version(hardware.driver), capability = version(hardware.cudaVersion)
  const runtime: BootstrapRuntime = {
    id: legacy ? 'cu126' : 'cu130', label: legacy ? 'CUDA 12.6 · 旧显卡基础环境' : 'CUDA 13 · RTX 官方环境',
    cudaVersion: legacy ? '12.6' : '13.0', compatibility: 'supported',
    reason: legacy ? '此固定版本的 CUDA 12.6 包用于旧显卡；H3 自动安装仍需要 RTX 与足够显存' : '此固定版本的 ComfyUI 官方要求 RTX 使用 CUDA 13 运行包',
    warnings: ['应用自带 Python 和 GPU 运行库，无需另装 CUDA Toolkit；nvidia-smi 显示的是驱动支持的 CUDA 水平'], driverUrl: NVIDIA_DRIVER_URL
  }
  let issue = ''
  if (!rtx && !legacy) { runtime.compatibility = 'unsupported'; issue = '未识别到受支持的 NVIDIA RTX 或旧款 GTX / Quadro，请连接已安装环境或查看手动教程' }
  else if (!driver) { runtime.compatibility = 'unknown'; issue = '未读取到 NVIDIA 驱动版本，请先检查显卡驱动并重新检测；暂不下载大型模型' }
  else if (legacy) {
    if (!atLeast(driver, 528, 33) || capability && capability[0] < 12) {
      runtime.compatibility = 'driver-update-required'; issue = 'CUDA 12.6 基础环境需要支持 CUDA 12 系列的驱动，请更新 NVIDIA 驱动后重新检查'
    } else if (!atLeast(driver, 560, 76) || capability && !atLeast(capability, 12, 6)) {
      runtime.compatibility = 'conditional'; runtime.warnings.push('当前驱动仅能条件尝试 CUDA 12 系列兼容；部分新功能或节点仍可能需要升级驱动，安装前会执行 GPU 计算检查')
    }
  } else if (!atLeast(driver, 580) || capability && capability[0] < 13) {
    runtime.compatibility = 'driver-update-required'
    issue = `当前 NVIDIA 驱动 ${hardware.driver}${hardware.cudaVersion ? '（nvidia-smi CUDA ' + hardware.cudaVersion + '）' : ''}不满足此 RTX 官方环境的 CUDA 13 要求，请更新到 580 系列或更新驱动后重新检查；已下载模型保留`
  }
  if (issue) runtime.reason = issue
  return { runtime, hardwareIssues: issue ? [issue] : [] }
}
