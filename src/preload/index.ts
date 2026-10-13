import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('luckyx', { desktop: true })
