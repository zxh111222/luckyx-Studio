import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, shell, Tray } from 'electron'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWriteStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { createStudioService } from '../backend/service'
import { createBootstrapFetch } from './bootstrap-network'
import type { Settings, Snapshot, StudioService, UserWorkflowDocument } from '../shared/contracts'
import { getWindowBounds } from '../shared/window-bounds'
import { validateReferenceUrl } from '../shared/reference-url'
import { createWorkflowEditorManager, sanitizeWorkflowFilename, type WorkflowEditorManager } from './workflow-editor'
import { createCloseCoordinator, getCloseRuntimeSummary, parseClosePreferences, validateClosePreference, type ClosePreference, type CloseRequest, type CloseSource } from '../shared/close-policy'
import type { BootstrapState } from '../shared/bootstrap'

const here = dirname(fileURLToPath(import.meta.url))
// Keep the existing data location stable across branding and version changes.
app.setName('luckyx-studio')
let window: BrowserWindow | null = null
let service: StudioService
let workflowEditors: WorkflowEditorManager | undefined
let closing = false
let quitRequested = false
let sessionEnding = false
let rendererReady = false
let nativeCloseDialog = false
let tray: Tray | null = null
let closePreference: ClosePreference = 'ask'
let closePreferencePath = ''
let preferenceWrites = Promise.resolve()
let shutdownFlight: Promise<void> | null = null
let closeCoordinator: ReturnType<typeof createCloseCoordinator> | undefined
protocol.registerSchemesAsPrivileged([{ scheme: 'luckyx', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
const single = app.requestSingleInstanceLock()
if (!single) app.quit()

async function saveClosePreference(behavior: ClosePreference): Promise<void> {
  const next = validateClosePreference(behavior)
  const write = preferenceWrites.catch(() => {}).then(async () => {
    await fs.writeFile(closePreferencePath + '.tmp', JSON.stringify({ version: 1, behavior: next }), 'utf8')
    await fs.rename(closePreferencePath + '.tmp', closePreferencePath)
    closePreference = next
  })
  preferenceWrites = write
  await write
}

function showMainWindow(): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (rendererReady && service) void service.invoke('snapshot').then(snapshot => {
    if (window && !window.webContents.isDestroyed()) window.webContents.send('studio:snapshot', snapshot)
  }).catch(() => {})
}

function ensureTray(): void {
  if (tray && !tray.isDestroyed()) return
  tray = new Tray(join(here, '../renderer/brand/icon-256.png'))
  tray.setToolTip('luckyx. Studio · 本地创作')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 luckyx. Studio', click: showMainWindow },
    { type: 'separator' },
    { label: '退出并停止后台', click: () => { void requestClose('tray') } }
  ]))
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

async function shutdownService(): Promise<void> {
  if (shutdownFlight) return shutdownFlight
  shutdownFlight = (async () => {
    workflowEditors?.dispose()
    const cleanup = (async () => {
      await preferenceWrites.catch(() => {})
      // This command kills only the engine process owned by this service.
      await service.invoke('lifecycle.shutdown')
      await service.dispose()
    })()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([cleanup, new Promise<void>(resolve => { timeout = setTimeout(resolve, sessionEnding ? 2000 : 12000) })])
    } catch (error) { console.error('luckyx. Studio shutdown:', error) }
    finally { if (timeout) clearTimeout(timeout) }
    tray?.destroy()
    tray = null
  })()
  return shutdownFlight
}

async function quitStudio(): Promise<void> {
  if (closing) return
  quitRequested = true
  if (service) await shutdownService()
  if (closing) return
  closing = true
  app.quit()
}

function notifyCloseRequest(request: CloseRequest): void {
  showMainWindow()
  if (rendererReady && window && !window.webContents.isDestroyed()) {
    window.webContents.send('studio:close-requested', request)
    return
  }
  // Native fallback is only for an unavailable/crashed renderer.
  nativeCloseDialog = true
  void dialog.showMessageBox({
    type: 'question', title: '关闭 luckyx. Studio',
    message: '继续在后台运行，还是退出并停止后台？',
    detail: '继续后台会保留下载和生成任务。退出会停止本应用启动的引擎，外部 ComfyUI 不受影响。',
    buttons: ['继续后台', '退出并停止后台', '取消'], defaultId: 0, cancelId: 2, noLink: true
  }).then(({ response }) => closeCoordinator?.resolve({ id: request.id, action: response === 0 ? 'background' : response === 1 ? 'quit' : 'cancel' }))
    .catch(error => {
      if (closeCoordinator?.current()) void closeCoordinator.resolve({ id: request.id, action: 'cancel' }).catch(() => {})
      dialog.showErrorBox('关闭未完成', error instanceof Error ? error.message : '请重试关闭窗口')
    }).finally(() => { nativeCloseDialog = false })
}

async function requestClose(source: CloseSource): Promise<void> {
  if (closing || quitRequested || sessionEnding) return
  try {
    const pending = closeCoordinator?.current()
    if (pending) {
      showMainWindow()
      if (!rendererReady && !nativeCloseDialog) notifyCloseRequest(pending)
      return
    }
    await closeCoordinator?.request(source)
  } catch (error) {
    showMainWindow()
    dialog.showErrorBox('关闭未完成', error instanceof Error ? error.message : '请重试关闭窗口')
  }
}

async function native(command: string, payload: unknown) {
  if (command === 'native.closePreferences.get') return { behavior: closePreference }
  if (command === 'native.closePreferences.set') {
    await saveClosePreference(validateClosePreference((payload as { behavior?: unknown } | null)?.behavior))
    return { behavior: closePreference }
  }
  if (command === 'native.close.resolve') {
    if (!closeCoordinator) throw new Error('关闭管理尚未就绪')
    return closeCoordinator.resolve(payload)
  }
  if (command === 'native.bootstrapDirectory') {
    const choice = await dialog.showOpenDialog(window!, { title: '选择环境安装磁盘或目录', properties: ['openDirectory', 'createDirectory'] })
    return choice.canceled ? false : choice.filePaths[0]
  }
  if (command === 'native.openReference') return shell.openExternal(validateReferenceUrl((payload as { url?: unknown })?.url))
  if (command === 'native.exportWorkflow') {
    const id = (payload as { id?: unknown })?.id
    if (typeof id !== 'string') throw new Error('工作流编号无效')
    const document = await service.invoke('workflow.get', { id }) as UserWorkflowDocument
    const destination = await dialog.showSaveDialog(window!, { title: '导出工作流 JSON', defaultPath: sanitizeWorkflowFilename(document.metadata.name), filters: [{ name: 'ComfyUI 工作流', extensions: ['json'] }] })
    if (destination.canceled || !destination.filePath) return false
    await fs.writeFile(destination.filePath, document.json, 'utf8')
    return destination.filePath
  }
  if (command === 'native.saveWorkflow') {
    if (!workflowEditors) throw new Error('节点编辑器尚未就绪')
    return workflowEditors.save((payload as { id: string })?.id)
  }
  const snapshot = await service.invoke('snapshot') as Snapshot
  if (command === 'native.editWorkflow') {
    if (!workflowEditors) throw new Error('节点编辑器尚未就绪')
    return workflowEditors.open((payload as { id: string })?.id, snapshot.settings.engineUrl)
  }
  if (command === 'native.openEngine') return shell.openExternal(snapshot.settings.engineUrl)
  if (command === 'native.chooseDirectory') {
    const field = (payload as { field: keyof Settings })?.field
    if (!['installationPath', 'modelPath', 'inputPath', 'outputPath'].includes(field)) throw new Error('目录类型无效')
    const choice = await dialog.showOpenDialog(window!, { title: '选择本地目录', defaultPath: String(snapshot.settings[field]), properties: ['openDirectory', 'createDirectory'] })
    if (choice.canceled) return false
    return service.invoke('settings.save', { [field]: choice.filePaths[0] })
  }
  if (command === 'native.openDirectory') {
    const field = (payload as { field: keyof Settings })?.field
    if (!['installationPath', 'modelPath', 'inputPath', 'outputPath'].includes(field)) throw new Error('目录类型无效')
    const error = await shell.openPath(String(snapshot.settings[field]))
    if (error) throw new Error('目录无法打开，请检查路径是否存在')
    return true
  }
  if (command === 'native.export') {
    const p = payload as { taskId: string; index: number }
    const media = await service.resolveMedia(p?.taskId, p?.index)
    const destination = await dialog.showSaveDialog(window!, { title: '导出视频', defaultPath: media.filename, filters: [{ name: 'MP4 视频', extensions: ['mp4'] }] })
    if (destination.canceled || !destination.filePath) return false
    const response = await net.fetch(media.url, { redirect: 'error' })
    if (!response.ok || !response.body) throw new Error('视频文件无法读取，请检查引擎与输出目录')
    const temporary = destination.filePath + '.luckyx-part'
    try {
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary))
      await fs.rename(temporary, destination.filePath)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw error
    }
    return destination.filePath
  }
  throw new Error('不支持的本地操作')
}

app.whenReady().then(async () => {
  if (!single) return
  if (process.platform === 'win32') app.setAppUserModelId('studio.luckyx.desktop')
  const dataDir = process.env.LUCKYX_DATA_DIR || (app.isPackaged ? join(app.getPath('userData'), 'studio') : resolve('.runtime/desktop'))
  service = await createStudioService({ dataDir, bootstrapFetch: createBootstrapFetch(options => net.request(options)), sevenZipPath: app.isPackaged ? join(process.resourcesPath, 'bootstrap/7za.exe') : resolve('node_modules/7zip-bin/win/x64/7za.exe') })
  closePreferencePath = join(dataDir, 'close-preferences.json')
  closePreference = parseClosePreferences(await fs.readFile(closePreferencePath, 'utf8').catch(() => null)).behavior
  closeCoordinator = createCloseCoordinator({
    getPreference: () => closePreference,
    setPreference: saveClosePreference,
    nextId: randomUUID,
    async getRuntime() {
      const snapshot = await service.invoke('snapshot') as Snapshot
      return getCloseRuntimeSummary(snapshot, service.invoke('bootstrap.status') as Promise<BootstrapState>)
    },
    notify: notifyCloseRequest,
    async perform(action) {
      if (action === 'background') { ensureTray(); window?.hide(); return }
      await quitStudio()
    }
  })
  protocol.handle('luckyx', async request => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'media') return new Response('Not found', { status: 404 })
      const media = await service.resolveMedia(url.searchParams.get('taskId') || '', Number(url.searchParams.get('index')))
      const headers = new Headers()
      if (request.headers.has('range')) headers.set('range', request.headers.get('range')!)
      return net.fetch(media.url, { headers, redirect: 'error' })
    } catch { return new Response('Video not available', { status: 404 }) }
  })
  window = new BrowserWindow({
    ...getWindowBounds(screen.getPrimaryDisplay().workAreaSize),
    frame: false, title: 'luckyx. Studio', icon: join(here, '../renderer/brand/icon-256.png'), backgroundColor: '#f6f7f8', show: false,
    webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  workflowEditors = createWorkflowEditorManager({
    Window: BrowserWindow, service, getParent: () => window,
    getBounds: () => getWindowBounds(screen.getPrimaryDisplay().workAreaSize),
    iconPath: join(here, '../renderer/brand/icon-256.png')
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url)
    if (target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', event => event.preventDefault())
  ipcMain.handle('studio:invoke', async (event, command, payload) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: '无效调用来源' }
    if (quitRequested) return { ok: false, error: '应用正在退出，请等待后台停止' }
    if (command === 'lifecycle.shutdown') return { ok: false, error: '内部生命周期操作不可直接调用' }
    try { return { ok: true, value: typeof command === 'string' && command.startsWith('native.') ? await native(command, payload) : await service.invoke(command, payload) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败，请查看诊断' } }
  })
  ipcMain.on('studio:window', (event, action) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return
    if (action === 'minimize') window.minimize()
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    if (action === 'close') window.close()
  })
  const unsubscribe = service.subscribe(snapshot => { if (window?.isVisible() && !window.webContents.isDestroyed()) window.webContents.send('studio:snapshot', snapshot) })
  window.on('close', event => {
    if (closing || sessionEnding) return
    event.preventDefault()
    void requestClose('window')
  })
  window.on('query-session-end', () => { sessionEnding = true; void quitStudio() })
  window.on('session-end', () => { sessionEnding = true; void quitStudio() })
  window.on('closed', () => { workflowEditors?.dispose(); unsubscribe(); window = null })
  const rendererUnavailable = () => {
    rendererReady = false
    const request = closeCoordinator?.current()
    if (request && !nativeCloseDialog && !quitRequested && !sessionEnding) notifyCloseRequest(request)
  }
  window.on('unresponsive', rendererUnavailable)
  window.on('responsive', () => { rendererReady = true })
  window.webContents.on('render-process-gone', rendererUnavailable)
  window.webContents.on('did-finish-load', () => {
    rendererReady = true
    const request = closeCoordinator?.current()
    if (request && !nativeCloseDialog) window?.webContents.send('studio:close-requested', request)
  })
  window.once('ready-to-show', () => window?.show())
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(here, '../renderer/index.html'))
}).catch(error => {
  dialog.showErrorBox('luckyx. Studio 启动失败', error instanceof Error ? error.message : '无法打开本地服务')
  app.quit()
})
app.on('second-instance', showMainWindow)
app.on('activate', showMainWindow)
app.on('window-all-closed', () => { void quitStudio() })
app.on('before-quit', event => {
  if (!service || closing || sessionEnding) return
  event.preventDefault()
  if (quitRequested) void quitStudio()
  else void requestClose('tray')
})
