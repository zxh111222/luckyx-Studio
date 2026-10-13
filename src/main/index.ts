import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1440, height: 1024, minWidth: 1280, minHeight: 800,
    title: 'luckyx. Studio', backgroundColor: '#101315',
    webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(here, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
