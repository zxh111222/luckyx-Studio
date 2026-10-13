export interface WorkAreaSize { width: number; height: number }
export interface WindowBounds { width: number; height: number; minWidth: number; minHeight: number }

/** Electron work-area values are logical pixels, already adjusted for display scaling. */
export function getWindowBounds(workArea: WorkAreaSize): WindowBounds {
  const { width, height } = workArea;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new RangeError('工作区宽高必须为有效的正数');
  }
  const availableWidth = Math.floor(width);
  const availableHeight = Math.floor(height);
  return {
    width: Math.min(1440, availableWidth),
    height: Math.min(1024, availableHeight),
    minWidth: Math.min(1200, availableWidth),
    minHeight: Math.min(720, availableHeight),
  };
}
