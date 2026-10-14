import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('luckyx', {
  desktop: true,
  async invoke(command: string, payload?: unknown) {
    const response = await ipcRenderer.invoke('studio:invoke', command, payload)
    if (!response.ok) throw new Error(response.error)
    return response.value
  },
  onSnapshot(callback: (value: unknown) => void) {
    const listener = (_event: unknown, value: unknown) => callback(value)
    ipcRenderer.on('studio:snapshot', listener)
    return () => ipcRenderer.removeListener('studio:snapshot', listener)
  },
  onCloseRequested(callback: (value: unknown) => void) {
    const listener = (_event: unknown, value: unknown) => callback(value)
    ipcRenderer.on('studio:close-requested', listener)
    return () => ipcRenderer.removeListener('studio:close-requested', listener)
  },
  windowControl(action: string) { ipcRenderer.send('studio:window', action) }
})
