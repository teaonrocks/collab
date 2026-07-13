export type ManagedAccountWindow = {
  readonly isDestroyed: () => boolean
  readonly show: () => void
  readonly hide: () => void
  readonly destroy: () => void
}

export const selectActiveWindowRecord = <Record>(
  records: ReadonlyMap<number, Record>,
  focusedWindowId: number | null,
  lastFocusedWindowId: number | null
): Record | null => {
  if (focusedWindowId !== null) {
    const focused = records.get(focusedWindowId)
    if (focused !== undefined) return focused
  }
  if (lastFocusedWindowId !== null) return records.get(lastFocusedWindowId) ?? null
  return null
}

export const retireAccountWindow = (window: ManagedAccountWindow): void => {
  if (window.isDestroyed()) return
  window.hide()
  window.destroy()
}

export const revealReplacementThenRetire = async <Window extends ManagedAccountWindow>(options: {
  readonly source: ManagedAccountWindow
  readonly replacement: Window
  readonly loadReplacement: () => Promise<void>
}): Promise<Window> => {
  try {
    await options.loadReplacement()
    if (options.replacement.isDestroyed()) {
      throw new Error("The replacement account window closed before it finished loading.")
    }
    options.replacement.show()
    retireAccountWindow(options.source)
    return options.replacement
  } catch (cause) {
    retireAccountWindow(options.replacement)
    throw cause
  }
}
