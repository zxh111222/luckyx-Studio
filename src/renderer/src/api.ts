import type { Snapshot, OutputFile } from '../../shared/contracts'
import { validateReferenceUrl } from '../../shared/reference-url'

interface DesktopBridge {
  desktop: boolean
  invoke(command: string, payload?: unknown): Promise<unknown>
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
}

declare global { interface Window { luckyx?: DesktopBridge } }
export const desktop = Boolean(window.luckyx?.desktop)
export type UiStressInterceptor = (command: string, payload: unknown, next: (command: string, payload?: unknown) => Promise<unknown>) => Promise<unknown>
let uiStressInterceptor: UiStressInterceptor | null = null
let uiStressActive: () => boolean = () => false
export function setUiStressInterceptor(handler: UiStressInterceptor | null, isActive: () => boolean = () => false): void {
  if (import.meta.env.DEV) { uiStressInterceptor = handler; uiStressActive = handler ? isActive : () => false }
}

export async function invoke<T = unknown>(command: string, payload?: unknown): Promise<T> {
  if (import.meta.env.DEV && uiStressInterceptor) return await uiStressInterceptor(command, payload, realInvoke) as T
  return await realInvoke(command, payload) as T
}
async function realInvoke<T = unknown>(command: string, payload?: unknown): Promise<T> {
  if (window.luckyx?.invoke) return await window.luckyx.invoke(command, payload) as T
  if (command.startsWith('native.')) {
    if (command === 'native.openReference') {
      const url = validateReferenceUrl((payload as { url?: unknown })?.url)
      window.open(url, '_blank', 'noopener,noreferrer')
      return undefined as T
    }
    if (command === 'native.openEngine') {
      const state = await invoke<Snapshot>('snapshot')
      window.open(state.settings.engineUrl, '_blank', 'noopener,noreferrer')
      return undefined as T
    }
    if (command === 'native.export') {
      const p = payload as { taskId: string; index: number }
      const a = document.createElement('a')
      a.href = `/api/media?taskId=${encodeURIComponent(p.taskId)}&index=${p.index}&download=1`
      a.download = 'luckyx-video.mp4'
      a.click()
      return undefined as T
    }
    throw new Error('此操作请在桌面版中使用；浏览器预览可直接编辑目录。')
  }
  const response = await fetch('/api/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, payload }), signal: AbortSignal.timeout(45000)
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.error || '本地服务暂时不可用')
  return result.value as T
}

export function subscribe(callback: (snapshot: Snapshot) => void): () => void {
  if (window.luckyx?.onSnapshot) return window.luckyx.onSnapshot(callback)
  let closed = false
  let pending = false
  const poll = async () => {
    if (closed || pending || document.hidden) return
    if (import.meta.env.DEV && uiStressActive()) return
    pending = true
    try { const state = await invoke<Snapshot>('snapshot'); if (!closed) callback(state) }
    catch { /* Initial connection errors are surfaced by the explicit refresh. */ }
    finally { pending = false }
  }
  const timer = window.setInterval(poll, 1500)
  return () => { closed = true; window.clearInterval(timer) }
}

export function mediaUrl(output: OutputFile): string {
  if (!desktop) return output.url
  const url = new URL(output.url, 'http://127.0.0.1')
  return `luckyx://media${url.search}`
}
