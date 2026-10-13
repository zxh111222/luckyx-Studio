import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import type { StudioService, UserWorkflowDocument, WorkflowFormat } from '../shared/contracts'
import { MAX_WORKFLOW_BYTES, parseWorkflowJson } from '../shared/workflow-library'
import { validateEngineUrl } from '../shared/workflow'

const COMPATIBILITY_ERROR = '节点编辑器未就绪或 ComfyUI 前端版本不兼容，请更新前端，或在原生界面手动导入 JSON。'

function scriptTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 30000) throw new Error('编辑器等待时间无效')
  return value
}

/** Fixed self-contained page source; bundlers must not rewrite its dynamic import or closures. */
const EDITOR_BRIDGE_SOURCE = String.raw`async function (encoded, format, action, timeoutMs, maxBytes) {
  const compatibilityError = '节点编辑器未就绪或 ComfyUI 前端版本不兼容，请更新前端，或在原生界面手动导入 JSON。'
  const deadline = Date.now() + timeoutMs
  let importedApp = null
  let importStarted = false
  let comfyApp = null
  while (Date.now() < deadline) {
    const candidate = window.comfyAPI?.app?.app ?? importedApp
    const method = action === 'save' ? candidate?.graph?.serialize : format === 'ui' ? candidate?.loadGraphData : candidate?.loadApiJson
    if (candidate?.graph && typeof method === 'function') {
      comfyApp = candidate
      break
    }
    if (!importStarted) {
      importStarted = true
      // Compatibility shim in the native ComfyUI frontend; always same-origin.
      void import('/scripts/app.js').then(module => { importedApp = module.app }).catch(() => {})
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))))
  }
  if (!comfyApp) throw new Error(compatibilityError)
  const wait = async operation => {
    let timer
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(compatibilityError)), Math.max(1, deadline - Date.now()))
      })])
    } finally { if (timer) clearTimeout(timer) }
  }
  if (action === 'save') {
    const graph = await wait(Promise.resolve(comfyApp.graph.serialize()))
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new Error('编辑器没有返回有效的工作流 JSON')
    const json = JSON.stringify(graph, null, 2)
    if (new TextEncoder().encode(json).byteLength > maxBytes) throw new Error('工作流 JSON 文件不能超过 5 MiB')
    return json
  }
  if (!encoded) throw new Error('没有待加载的工作流')
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
  const graph = JSON.parse(new TextDecoder().decode(bytes))
  // Loading and saving do not invoke queuePrompt or any execution endpoint.
  const loaded = format === 'ui'
    ? await wait(Promise.resolve(comfyApp.loadGraphData(graph)))
    : await wait(Promise.resolve(comfyApp.loadApiJson(graph)))
  if (loaded === false) throw new Error('原生编辑器无法载入此工作流，请检查节点与前端版本。')
  return { loaded: true, format }
}`

export function buildEditorLoadScript(json: string, format: WorkflowFormat, timeoutMs = 15000): string {
  const parsed = parseWorkflowJson(json)
  if (!['ui', 'api'].includes(format) || parsed.format !== format) throw new Error('工作流格式与记录不一致')
  const encoded = Buffer.from(json, 'utf8').toString('base64')
  return `(${EDITOR_BRIDGE_SOURCE})(${JSON.stringify(encoded)}, ${JSON.stringify(format)}, "load", ${scriptTimeout(timeoutMs)}, ${MAX_WORKFLOW_BYTES})`
}

export function buildEditorSaveScript(timeoutMs = 5000): string {
  return `(${EDITOR_BRIDGE_SOURCE})(null, null, "save", ${scriptTimeout(timeoutMs)}, ${MAX_WORKFLOW_BYTES})`
}

export function isAllowedEditorNavigation(url: string, engineUrl: string): boolean {
  try {
    const origin = validateEngineUrl(engineUrl)
    const candidate = new URL(url)
    return candidate.protocol === 'http:' && candidate.origin === origin && !candidate.username && !candidate.password
  } catch { return false }
}

export function sanitizeWorkflowFilename(value: unknown): string {
  let name = typeof value === 'string' ? value.trim().replace(/\.json$/i, '') : ''
  name = Array.from(name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')).slice(0, 80).join('').replace(/[. ]+$/g, '')
  if (!name || name === '.' || name === '..') name = 'workflow'
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return name + '.json'
}

export interface WorkflowEditorManager {
  open(id: string, engineUrl: string): Promise<{ id: string; opened: true; reused: boolean }>
  save(id: string): Promise<unknown>
  dispose(): void
}

interface EditorEntry { window: BrowserWindow; origin: string; ready: Promise<void> }

function workflowId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('工作流编号无效')
  return value
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) })])
  } finally { if (timer) clearTimeout(timer) }
}

/** Every editor owns a fresh non-persistent session and its own graph. */
export function createWorkflowEditorManager(options: {
  Window: new (options: BrowserWindowConstructorOptions) => BrowserWindow
  service: Pick<StudioService, 'invoke'>
  getParent: () => BrowserWindow | null
  getBounds: () => { width: number; height: number; minWidth: number; minHeight: number }
  iconPath: string
}): WorkflowEditorManager {
  const entries = new Map<string, EditorEntry>()
  const opening = new Map<string, Promise<{ id: string; opened: true; reused: boolean }>>()
  let disposed = false

  function focus(editor: BrowserWindow) {
    if (editor.isMinimized()) editor.restore()
    editor.show()
    editor.focus()
  }

  const manager: WorkflowEditorManager = {
    async open(idValue, engineUrl) {
      const id = workflowId(idValue)
      if (disposed) throw new Error('启动器已关闭')
      const existing = entries.get(id)
      if (existing && !existing.window.isDestroyed()) {
        await existing.ready
        focus(existing.window)
        return { id, opened: true, reused: true }
      }
      const inflight = opening.get(id)
      if (inflight) return inflight
      const task = (async () => {
        const origin = validateEngineUrl(engineUrl)
        const document = await options.service.invoke('workflow.get', { id }) as UserWorkflowDocument
        if (!document || typeof document.json !== 'string' || !document.metadata || document.metadata.id !== id) throw new Error('工作流文件无法读取')
        const source = buildEditorLoadScript(document.json, document.metadata.format)
        const parent = options.getParent()
        if (disposed || !parent || parent.isDestroyed()) throw new Error('启动器已关闭')
        const editor = new options.Window({
          ...options.getBounds(), parent, title: `luckyx. 节点编辑器 · ${document.metadata.name}`,
          icon: options.iconPath, backgroundColor: '#101315', show: false, autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true, webviewTag: false, partition: 'luckyx-workflow-' + randomUUID() }
        })
        const contents = editor.webContents
        const session = contents.session
        session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
        session.setPermissionCheckHandler(() => false)
        contents.setWindowOpenHandler(() => ({ action: 'deny' }))
        contents.on('will-navigate', (event, url) => { if (!isAllowedEditorNavigation(url, origin)) event.preventDefault() })
        contents.on('will-frame-navigate', event => { if (!isAllowedEditorNavigation(event.url, origin)) event.preventDefault() })
        contents.on('will-redirect', (event, url) => { if (!isAllowedEditorNavigation(url, origin)) event.preventDefault() })
        contents.on('will-attach-webview', event => event.preventDefault())
        session.on('will-download', event => event.preventDefault())
        // Restrict requests too: the editor cannot send imported graph contents to remote hosts.
        session.webRequest.onBeforeRequest((details, callback) => {
          let allowed = isAllowedEditorNavigation(details.url, origin)
          try {
            const target = new URL(details.url)
            if (target.protocol === 'ws:') allowed = target.origin.replace(/^ws:/, 'http:') === origin && !target.username && !target.password
            if (target.protocol === 'blob:') allowed = target.origin === origin && !['mainFrame', 'subFrame'].includes(details.resourceType)
            if (target.protocol === 'data:') allowed = ['image', 'media', 'font'].includes(details.resourceType)
          } catch { /* Invalid request URLs are denied. */ }
          callback({ cancel: !allowed })
        })
        const entry: EditorEntry = { window: editor, origin, ready: Promise.resolve() }
        entries.set(id, entry)
        editor.on('closed', () => {
          if (entries.get(id) === entry) entries.delete(id)
          void session.clearStorageData().catch(() => {})
        })
        entry.ready = (async () => {
          try {
            await withDeadline(editor.loadURL(origin + '/'), 20000, '本地节点编辑器无法打开，请先确认 ComfyUI 引擎已启动。')
            if (editor.isDestroyed() || !isAllowedEditorNavigation(contents.getURL(), origin)) throw new Error('节点编辑器已关闭或离开本地引擎')
            const result = await withDeadline(contents.executeJavaScript(source), 18000, COMPATIBILITY_ERROR)
            if (!result || result.loaded !== true) throw new Error(COMPATIBILITY_ERROR)
          } catch (error) {
            if (!editor.isDestroyed()) editor.destroy()
            throw error
          }
        })()
        await entry.ready
        if (disposed || editor.isDestroyed()) throw new Error('节点编辑器已关闭')
        focus(editor)
        return { id, opened: true as const, reused: false }
      })()
      opening.set(id, task)
      try { return await task } finally { if (opening.get(id) === task) opening.delete(id) }
    },
    async save(idValue) {
      const id = workflowId(idValue)
      if (disposed) throw new Error('启动器已关闭')
      const entry = entries.get(id)
      if (!entry || entry.window.isDestroyed()) throw new Error('请先打开该工作流的节点编辑器')
      await entry.ready
      const contents = entry.window.webContents
      if (contents.isDestroyed() || !isAllowedEditorNavigation(contents.getURL(), entry.origin)) throw new Error('编辑窗口已离开本地引擎，请重新打开')
      const json: unknown = await withDeadline(contents.executeJavaScript(buildEditorSaveScript()), 7000, COMPATIBILITY_ERROR)
      if (typeof json !== 'string') throw new Error('编辑器没有返回有效的工作流 JSON')
      parseWorkflowJson(json)
      return options.service.invoke('workflow.update', { id, json })
    },
    dispose() {
      disposed = true
      for (const entry of entries.values()) if (!entry.window.isDestroyed()) entry.window.destroy()
      entries.clear()
    }
  }
  return manager
}
