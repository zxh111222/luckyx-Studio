// Model grid and temporal alignment follow ComfyUI MiniMaxH3ImageToVideo.
// Dimension bounds are conservative Studio limits, not performance guarantees.
export const H3_MAX_PIXELS = 1344 * 768
export const H3_RESOLUTIONS = [
  { label: '864 × 480 · 默认', width: 864, height: 480 },
  { label: '832 × 480', width: 832, height: 480 },
  { label: '480 × 864 · 竖屏', width: 480, height: 864 },
  { label: '768 × 768 · 方形', width: 768, height: 768 },
  { label: '1280 × 704 · 横屏', width: 1280, height: 704 },
  { label: '1344 × 768 · 横屏', width: 1344, height: 768 },
  { label: '768 × 1344 · 竖屏', width: 768, height: 1344 },
]
export const H3_DURATIONS = [56, 124, 243, 362]
export function h3FramesForSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 5 / 24 || seconds > 362 / 24) throw new Error('时长需在约 0.21～15.08 秒之间')
  return 5 + 17 * Math.ceil((Math.ceil(seconds * 24) - 5) / 17)
}
export function isVerifiedH3Configuration(width: number, height: number, frames: number, mode = 'image') {
  return mode === 'image' && width === 864 && height === 480 && frames === 124
}
