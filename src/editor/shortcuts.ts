// Central table for the commands implemented through ML-011. Fields retain their native bindings.
export const SHORTCUTS = [
  { key: 's', modifier: true, shift: false, action: 'save' },
  { key: 'z', modifier: true, shift: false, action: 'undo' },
  { key: 'z', modifier: true, shift: true, action: 'redo' },
  { key: 'y', modifier: true, shift: false, action: 'redo' },
  { key: 'd', modifier: true, shift: false, action: 'duplicate' },
  { key: 'c', modifier: true, shift: false, action: 'copy' },
  { key: 'v', modifier: true, shift: false, action: 'paste' },
  { key: 'delete', modifier: false, shift: false, action: 'delete' },
  { key: 'backspace', modifier: false, shift: false, action: 'delete' },
  { key: 'escape', modifier: false, shift: false, action: 'escape' },
  { key: 'v', modifier: false, shift: false, action: 'select' },
  { key: 'g', modifier: false, shift: false, action: 'grid' },
] as const;
export function shortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): typeof SHORTCUTS[number]['action'] | undefined {
  if (e.altKey) return undefined;
  return SHORTCUTS.find((s) => s.key === e.key.toLowerCase() && s.modifier === (e.ctrlKey || e.metaKey) && s.shift === e.shiftKey)?.action;
}
