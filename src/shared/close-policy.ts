import type { Snapshot } from './contracts'

export type ClosePreference = 'ask' | 'background' | 'quit'
export type CloseSource = 'window' | 'tray'
export type CloseAction = 'cancel' | 'background' | 'quit'

export interface CloseRuntimeSummary {
  activeTasks: number
  activeDownloads: boolean
  managedEngine: boolean
  externalEngine: boolean
}

export interface CloseRequest extends CloseRuntimeSummary {
  id: string
  source: CloseSource
}

export interface CloseResolution {
  id: string
  action: CloseAction
  remember?: boolean
}

/** Slow installation recovery must never prevent a close confirmation. */
export async function getCloseRuntimeSummary(
  snapshot: Pick<Snapshot, 'tasks' | 'engine'>,
  installationStatus: Promise<{ status: string }>,
  maximumWaitMs = 750
): Promise<CloseRuntimeSummary> {
  let deadline: ReturnType<typeof setTimeout> | undefined
  let status: { status: string }
  try {
    status = await Promise.race([
      installationStatus.catch(() => ({ status: 'planning' })),
      new Promise<{ status: string }>(resolve => { deadline = setTimeout(() => resolve({ status: 'planning' }), maximumWaitMs) })
    ])
  } finally { if (deadline) clearTimeout(deadline) }
  return {
    activeTasks: Math.max(snapshot.tasks.filter(task => ['submitting', 'queued', 'running', 'unknown'].includes(task.status)).length, snapshot.engine.queue || 0),
    activeDownloads: ['planning', 'downloading', 'verifying', 'extracting'].includes(status.status),
    managedEngine: snapshot.engine.managed,
    externalEngine: !snapshot.engine.managed && ['ready', 'busy'].includes(snapshot.engine.status)
  }
}

export function validateClosePreference(value: unknown): ClosePreference {
  if (value !== 'ask' && value !== 'background' && value !== 'quit') throw new Error('关闭行为无效')
  return value
}

/** A missing or damaged preference must always ask again. */
export function parseClosePreferences(raw: string | null | undefined): { behavior: ClosePreference } {
  try {
    const parsed = JSON.parse(raw || '{}')
    return { behavior: validateClosePreference(parsed?.behavior) }
  } catch { return { behavior: 'ask' } }
}

export function chooseCloseAction(preference: ClosePreference, source: CloseSource, runtime: CloseRuntimeSummary): 'ask' | 'background' | 'quit' {
  // The tray's explicit exit never inherits "continue in background".
  if (source === 'tray') return runtime.activeTasks > 0 || runtime.activeDownloads ? 'ask' : 'quit'
  return preference
}

export interface CloseCoordinatorOptions {
  getPreference(): ClosePreference
  setPreference(value: ClosePreference): Promise<void>
  getRuntime(): Promise<CloseRuntimeSummary>
  nextId(): string
  notify(request: CloseRequest): void
  perform(action: Exclude<CloseAction, 'cancel'>): Promise<void>
}

/** Coordinates X, Alt+F4 and tray exit without duplicate dialogs or actions. */
export function createCloseCoordinator(options: CloseCoordinatorOptions) {
  let pending: CloseRequest | null = null
  let requestFlight: Promise<CloseRequest | null> | null = null
  let resolving = false
  let quitting = false

  async function perform(action: Exclude<CloseAction, 'cancel'>): Promise<void> {
    if (action === 'quit') quitting = true
    try { await options.perform(action) }
    catch (error) { quitting = false; throw error }
  }

  function request(source: CloseSource): Promise<CloseRequest | null> {
    if (quitting) return Promise.resolve(null)
    if (pending) return Promise.resolve(pending)
    if (requestFlight) return requestFlight
    requestFlight = (async () => {
      const runtime = await options.getRuntime()
      const action = chooseCloseAction(options.getPreference(), source, runtime)
      if (action !== 'ask') { await perform(action); return null }
      pending = { ...runtime, id: options.nextId(), source }
      try { options.notify({ ...pending }) }
      catch (error) { pending = null; throw error }
      return pending
    })().finally(() => { requestFlight = null })
    return requestFlight
  }

  async function resolve(value: unknown): Promise<{ action: CloseAction }> {
    const input = value as Partial<CloseResolution> | null
    if (!pending || input?.id !== pending.id) throw new Error('关闭请求已失效，请重新关闭窗口')
    if (resolving) throw new Error('正在处理关闭选择')
    if (!['cancel', 'background', 'quit'].includes(String(input.action))) throw new Error('关闭操作无效')
    if (input.remember !== undefined && typeof input.remember !== 'boolean') throw new Error('记住选择格式无效')
    const action = input.action as CloseAction
    resolving = true
    try {
      if (action === 'cancel') { pending = null; return { action } }
      // Persist only an explicit decision. A cancelled dialog changes nothing.
      if (input.remember) await options.setPreference(action)
      await perform(action)
      pending = null
      return { action }
    } finally { resolving = false }
  }

  return { request, resolve, current: () => pending ? { ...pending } : null, isQuitting: () => quitting }
}
