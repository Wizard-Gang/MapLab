import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isDirty } from '../editor/history';
import { ROUTES, type LibraryEntry } from '../library/protocol';
import type { OpenDoc } from './store';

/** Saved-revision export: an unsaved gesture or draft cannot silently select another source revision. */
export function ExportPanel({ doc, busy, entry }: { readonly doc: OpenDoc; readonly busy: boolean; readonly entry: LibraryEntry | undefined }): ReactNode {
  const [message, setMessage] = useState(''), [working, setWorking] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const run = async (): Promise<void> => {
    if (!entry?.digest) return;
    const abort = new AbortController(); controller.current = abort; setWorking(true); setMessage('Building saved dependency closure…');
    try {
      const response = await fetch(ROUTES.export, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ entryMapId: doc.id, baseDigest: entry.digest }), signal: abort.signal });
      if (!response.ok || response.headers.get('content-type') !== 'application/zip') {
        const result = await response.json() as { message?: string }; throw new Error(result.message ?? 'Export refused');
      }
      const blob = await response.blob(); if (abort.signal.aborted) return;
      const digest = response.headers.get('x-maplab-bundle-sha256') ?? '';
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `maplab-${digest.slice(0, 12)}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const warnings = response.headers.get('x-maplab-warning-count') ?? '0';
      setMessage(`Exported saved map. Bundle SHA-256 ${digest}. ${warnings} validation warnings; see Problems for source diagnostics.`);
    } catch (e) { setMessage(abort.signal.aborted ? 'Export cancelled.' : e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); controller.current = null; }
  };
  const blocked = busy || isDirty(doc.state) || !entry?.digest || entry.state !== 'ok' || doc.draft !== null || doc.changedOnDisk || doc.conflicts.length > 0;
  return <section aria-label="Export">
    <button type="button" disabled={blocked || working} onClick={() => void run()}>Export saved map ZIP</button>
    {working && <button type="button" onClick={() => controller.current?.abort()}>Cancel export</button>}
    {isDirty(doc.state) && <span> Save changes before exporting.</span>}
    <p aria-live="polite">{message}</p>
  </section>;
}
