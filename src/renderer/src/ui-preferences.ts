export type UiPreferences = {
  motion: 'auto' | 'reduce'
  transparency: 'auto' | 'reduce'
  contrast: 'auto' | 'more'
}
export const UI_PREFERENCES_KEY = 'luckyx.ui-preferences.v1'
export const DEFAULT_UI_PREFERENCES: UiPreferences = { motion: 'auto', transparency: 'auto', contrast: 'auto' }
export function parseUiPreferences(raw: string | null): UiPreferences {
  try {
    const value = JSON.parse(raw || 'null')
    return { motion: value?.motion === 'reduce' ? 'reduce' : 'auto', transparency: value?.transparency === 'reduce' ? 'reduce' : 'auto', contrast: value?.contrast === 'more' ? 'more' : 'auto' }
  } catch { return { ...DEFAULT_UI_PREFERENCES } }
}
export function resolveReducedMotion(choice: UiPreferences['motion'], osReduce: boolean): boolean { return choice === 'reduce' || osReduce }

interface PreferenceMedia {
  matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}
export interface UiPreferencesHost {
  root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'>
  storage: Pick<Storage, 'getItem' | 'setItem'>
  events: Pick<Document, 'addEventListener' | 'removeEventListener'>
  windowEvents: Pick<Window, 'addEventListener' | 'removeEventListener'>
  matchMedia: (query: string) => PreferenceMedia
  onChange?: (preferences: UiPreferences) => void
}
/** Preference and input listeners live once per app, never on animation frames. */
export function createUiPreferencesController(host: UiPreferencesHost) {
  let preferences = { ...DEFAULT_UI_PREFERENCES }
  try { preferences = parseUiPreferences(host.storage.getItem(UI_PREFERENCES_KEY)) } catch { /* Storage is optional in restricted browser contexts. */ }
  let inputMethod: 'keyboard' | 'pointer' = 'pointer'
  let pressed: HTMLElement | null = null
  const media = {
    motion: host.matchMedia('(prefers-reduced-motion: reduce)'),
    transparency: host.matchMedia('(prefers-reduced-transparency: reduce)'),
    contrast: host.matchMedia('(prefers-contrast: more)')
  }
  function release() { pressed?.classList.remove('pointer-pressed'); pressed = null }
  function apply() {
    host.root.setAttribute('data-ui-motion', resolveReducedMotion(preferences.motion, media.motion.matches) ? 'reduce' : 'full')
    host.root.setAttribute('data-ui-transparency', preferences.transparency === 'reduce' || media.transparency.matches ? 'solid' : 'auto')
    host.root.setAttribute('data-ui-contrast', preferences.contrast === 'more' || media.contrast.matches ? 'more' : 'auto')
    host.root.setAttribute('data-ui-input', inputMethod)
    host.onChange?.({ ...preferences })
  }
  const keyboard = () => { release(); inputMethod = 'keyboard'; host.root.setAttribute('data-ui-input', inputMethod) }
  const pointer = (event: Event) => {
    release(); inputMethod = 'pointer'; host.root.setAttribute('data-ui-input', inputMethod)
    const pointerEvent = event as PointerEvent
    if (pointerEvent.button !== 0 || pointerEvent.isPrimary === false) return
    const element = (event.target as Element | null)?.closest?.<HTMLElement>('button, .btn, .text-button')
    if (!element || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return
    pressed = element; pressed.classList.add('pointer-pressed')
  }
  const storageChanged = (event: Event) => {
    const update = event as StorageEvent
    if (update.key !== UI_PREFERENCES_KEY && update.key !== null) return
    preferences = parseUiPreferences(update.newValue); apply()
  }
  Object.values(media).forEach(query => query.addEventListener('change', apply))
  host.events.addEventListener('keydown', keyboard, true)
  host.events.addEventListener('pointerdown', pointer, true)
  host.events.addEventListener('pointerup', release, true)
  host.events.addEventListener('pointercancel', release, true)
  host.windowEvents.addEventListener('blur', release)
  host.windowEvents.addEventListener('storage', storageChanged)
  apply()
  return {
    get inputMethod() { return inputMethod },
    get preferences() { return { ...preferences } },
    update(value: UiPreferences) {
      preferences = parseUiPreferences(JSON.stringify(value))
      try { host.storage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences)) } catch { /* Keep this session usable without persistence. */ }
      apply()
    },
    dispose() {
      release()
      Object.values(media).forEach(query => query.removeEventListener('change', apply))
      host.events.removeEventListener('keydown', keyboard, true)
      host.events.removeEventListener('pointerdown', pointer, true)
      host.events.removeEventListener('pointerup', release, true)
      host.events.removeEventListener('pointercancel', release, true)
      host.windowEvents.removeEventListener('blur', release)
      host.windowEvents.removeEventListener('storage', storageChanged)
    }
  }
}

/** Scope focus only while a modal is open; the task panel stays non-modal. */
export function createFocusTrap(container: HTMLElement, opener: HTMLElement | null, onEscape: () => void): (restore?: boolean) => void {
  const document = container.ownerDocument
  function controls() {
    return Array.from(container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]'))
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0)
  }
  function first() { return controls()[0] ?? container }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onEscape(); return }
    if (event.key !== 'Tab') return
    const items = controls()
    const active = document.activeElement
    if (!items.length) { event.preventDefault(); container.focus({ preventScroll: true }); return }
    const start = items[0], end = items[items.length - 1]
    if (event.shiftKey && (active === start || !container.contains(active))) { event.preventDefault(); end.focus({ preventScroll: true }) }
    else if (!event.shiftKey && (active === end || !container.contains(active))) { event.preventDefault(); start.focus({ preventScroll: true }) }
  }
  function focusin(event: FocusEvent) { if (!container.contains(event.target as Node)) first().focus({ preventScroll: true }) }
  document.addEventListener('keydown', keydown, true)
  document.addEventListener('focusin', focusin, true)
  const initial = container.querySelector<HTMLElement>('[autofocus]')
  const available = controls()
  ;(initial && available.includes(initial) ? initial : available[0] ?? container).focus({ preventScroll: true })
  return (restore = true) => {
    document.removeEventListener('keydown', keydown, true)
    document.removeEventListener('focusin', focusin, true)
    if (restore && opener?.isConnected && !opener.matches(':disabled')) opener.focus({ preventScroll: true })
  }
}
