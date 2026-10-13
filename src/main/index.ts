import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, shell } from 'electron'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWriteStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createStudioService } from '../backend/service'
import type { Settings, Snapshot, StudioService, UserWorkflowDocument } from '../shared/contracts'
import { getWindowBounds } from '../shared/window-bounds'
import { validateReferenceUrl } from '../shared/reference-url'
import { createWorkflowEditorManager, sanitizeWorkflowFilename, type WorkflowEditorManager } from './workflow-editor'

const here = dirname(fileURLToPath(import.meta.url))
let window: BrowserWindow | null = null
let service: StudioService
let workflowEditors: WorkflowEditorManager | undefined
let closing = false
protocol.registerSchemesAsPrivileged([{ scheme: 'luckyx', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
const single = app.requestSingleInstanceLock()
if (!single) app.quit()

async function native(command: string, payload: unknown) {
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
  service = await createStudioService({ dataDir })
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
    frame: false, title: 'luckyx. Studio', icon: join(here, '../renderer/brand/icon-256.png'), backgroundColor: '#101315', show: false,
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
    try { return { ok: true, value: typeof command === 'string' && command.startsWith('native.') ? await native(command, payload) : await service.invoke(command, payload) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败，请查看诊断' } }
  })
  ipcMain.on('studio:window', (event, action) => {
    if (event.sender !== window?.webContents) return
    if (action === 'minimize') window.minimize()
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    if (action === 'close') window.close()
  })
  const unsubscribe = service.subscribe(snapshot => { if (window && !window.webContents.isDestroyed()) window.webContents.send('studio:snapshot', snapshot) })
  window.on('closed', () => { workflowEditors?.dispose(); unsubscribe(); window = null })
  window.once('ready-to-show', () => window?.show())
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(here, '../renderer/index.html'))
}).catch(error => {
  dialog.showErrorBox('luckyx. Studio 启动失败', error instanceof Error ? error.message : '无法打开本地服务')
  app.quit()
})
app.on('second-instance', () => { window?.restore(); window?.focus() })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  workflowEditors?.dispose()
  if (!service || closing) return
  event.preventDefault()
  closing = true
  void service.dispose().finally(() => app.quit())
})
