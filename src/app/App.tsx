import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { shortcut } from '../editor/shortcuts';
import { SelectionPanel, Hierarchy } from './SelectionPanel';
import { GeometryPanel } from './GeometryPanel';
import { TerrainPanel } from './TerrainPanel';
import { TERRAIN_TOOLS, type TerrainTool } from '../editor/terrain';
import { Viewport } from './Viewport';
import { mapName, objectIds } from '../editor/document';
import { canRedo, canUndo, isDirty } from '../editor/history';
import type { LibraryEntry, LibrarySnapshot } from '../library/protocol';
import { LibraryStore, lockReason, type AppView, type OpenDoc } from './store';

const store = new LibraryStore();

const isField = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Platform Cmd/Ctrl+S saves anywhere; undo and redo stay with text fields while one has focus (adopted C1). */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const action = shortcut(e);
      if (action === 'save') {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (store.active()) store.cancelGestures(store.active()!.id);
        void store.save(); return;
      }
      if (!action || isField(e.target) || !store.active()) return;
      const id = store.active()!.id, selection = store.selection(id);
      // Native copy/paste events carry the browser clipboard payload; fields keep those events.
      if (action === 'copy' || action === 'paste') return;
      e.preventDefault();
      if (action === 'undo') { store.cancelGestures(id); store.undo(); }
      if (action === 'redo') { store.cancelGestures(id); store.redo(); }
      if (action === 'duplicate') selection.duplicate();
      if (action === 'delete') selection.askDelete();
      if (action === 'escape' && !store.terrain(id).cancel()) selection.escape();
      if ((TERRAIN_TOOLS as readonly string[]).includes(action) && selection.getSnapshot().mode === 'Terrain') store.terrain(id).tool(action as TerrainTool);
      if (action === 'select' && store.viewport(id).getSnapshot().panTool) store.viewport(id).panTool();
      if (action === 'grid') store.viewport(id).toggle('Grid');
    };
    const copy = (e: ClipboardEvent): void => {
      if (isField(e.target) || !store.active()) return;
      const selection = store.selection(store.active()!.id);
      if (!selection.getSnapshot().keys.length) return;
      e.preventDefault(); store.clipboard = selection.copy(); e.clipboardData?.setData('text/plain', store.clipboard); selection.message('Copied objects');
    };
    const paste = (e: ClipboardEvent): void => {
      if (isField(e.target) || !store.active()) return;
      e.preventDefault(); store.selection(store.active()!.id).paste(e.clipboardData?.getData('text/plain') || store.clipboard);
    };
    window.addEventListener('keydown', onKey); window.addEventListener('copy', copy); window.addEventListener('paste', paste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('copy', copy); window.removeEventListener('paste', paste); };
  }, []);
}

function Badges({ entry, drafted }: { readonly entry: LibraryEntry; readonly drafted: boolean }): ReactNode {
  return (
    <span className="badges">
      {entry.state !== 'ok' && <span className="badge bad">{entry.state}</span>}
      {entry.errors > 0 && <span className="badge bad">{entry.errors} errors</span>}
      {entry.warnings > 0 && <span className="badge">{entry.warnings} warnings</span>}
      <span className={drafted ? "badge" : "badge reserved"} aria-hidden={!drafted}>draft</span>
    </span>
  );
}

function TornEntry({ entry }: { readonly entry: LibraryEntry }): ReactNode {
  return (
    <div className="torn" role="group" aria-label={`Torn ${entry.id}`}>
      <p>{entry.path} does not match the project index: an earlier save was interrupted. Choose what to keep.</p>
      {entry.digest !== null && <button type="button" aria-label={`Keep file ${entry.id}`} onClick={() => void store.recover(entry.id, 'keep')}>Keep file</button>}
      <button type="button" aria-label={`Restore backup ${entry.id}`} disabled={!entry.restorable} onClick={() => void store.recover(entry.id, 'restore')}>Restore from newest backup</button>
      {entry.digest === null && <button type="button" aria-label={`Forget ${entry.id}`} onClick={() => void store.recover(entry.id, 'forget')}>Remove from the index</button>}
    </div>
  );
}

function NewMap({ library }: { readonly library: LibrarySnapshot }): ReactNode {
  const movements = library.documents.filter((e) => e.kind === 'movement');
  const tileset = library.documents.some((e) => e.kind === 'tileset');
  const [movementId, setMovement] = useState(library.defaults.movementId ?? movements[0]?.id ?? '');
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string): number => Number(f.get(k));
    store.newMap({ id: String(f.get('id')).trim(), name: String(f.get('name')).trim(), width: n('width'), height: n('height'), movementId, tileSize: tileset ? n('tile') : null });
  };
  return (
    <details className="new-map">
      <summary>New map</summary>
      <form onSubmit={submit} aria-label="New map">
        <label>Map ID <input name="id" required pattern="[a-z0-9][a-z0-9._\-]{0,95}" placeholder="map.meadow" /></label>
        <label>Name <input name="name" required aria-label="New map name" /></label>
        <label>Width (WU) <input name="width" type="number" min={64} max={131072} step={16} defaultValue={1280} /></label>
        <label>Height (WU) <input name="height" type="number" min={64} max={131072} step={16} defaultValue={720} /></label>
        <label>Tile size (WU) <input name="tile" type="number" min={1} step={1} defaultValue={library.defaults.tileSize[0]} disabled={!tileset} /></label>
        <label>Movement profile
          <select value={movementId} onChange={(e) => setMovement(e.target.value)}>{movements.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}</select>
        </label>
        <button type="submit" disabled={library.readOnly}>Create map</button>
      </form>
    </details>
  );
}

function LibraryPanel({ view }: { readonly view: AppView }): ReactNode {
  const library = view.library;
  if (!library) return null;
  const drafted = new Set(view.docs.filter((d) => d.drafted).map((d) => d.id));
  const kinds = ['map', 'tileset', 'prefab', 'movement', 'catalog', 'palette'] as const;
  return (
    <aside className="library" aria-label="Library">
      <h2>{library.name}</h2>
      {kinds.map((kind) => {
        const entries = library.documents.filter((e) => e.kind === kind);
        if (!entries.length) return null;
        return (
          <section key={kind} aria-label={`${kind} documents`}>
            <h3>{kind}s</h3>
            <ul>
              {entries.map((e) => (
                <li key={e.id}>
                  {kind === 'map'
                    ? <button type="button" aria-label={`Open ${e.id}`} disabled={e.state !== 'ok'} onClick={() => void store.open(e.id)}>{e.path}</button>
                    : <span>{e.path}</span>}
                  <Badges entry={e} drafted={drafted.has(e.id)} />
                  {e.state !== 'ok' && <TornEntry entry={e} />}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {library.unindexed.length > 0 && <p className="note">Not in the project index: {library.unindexed.join(', ')}</p>}
      {view.orphanDrafts.map((d) => (
        <div key={d.key} className="banner" role="group" aria-label={`Draft ${d.documentId}`}>
          Unsaved draft of new map {d.documentId} from {new Date(d.updatedAt).toLocaleString()}
          <button type="button" onClick={() => void store.restoreOrphan(d.documentId)}>Restore draft</button>
          <button type="button" onClick={() => void store.discardOrphan(d.documentId)}>Discard draft</button>
        </div>
      ))}
      {!library.readOnly && <NewMap library={library} />}
    </aside>
  );
}

function NameField({ doc }: { readonly doc: OpenDoc }): ReactNode {
  const current = mapName(doc.state.model);
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);
  return (
    <label className="name">Map name
      <input value={value} disabled={lockReason(doc) !== null} onChange={(e) => setValue(e.target.value)} onBlur={() => store.rename(value)}
        onKeyDown={(e) => { if (e.key === 'Enter') store.rename(value); if (e.key === 'Escape') setValue(current); }} />
    </label>
  );
}

function SaveAs({ doc }: { readonly doc: OpenDoc }): ReactNode {
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void store.saveAs(String(f.get('id')), String(f.get('name')));
  };
  return (
    <details className="save-as">
      <summary>Save As / Duplicate…</summary>
      <form onSubmit={submit} aria-label="Save As">
        <label>New map ID <input name="id" required defaultValue={`${doc.id}-copy`} /></label>
        <label>New map name <input name="name" required defaultValue={`${mapName(doc.state.model)} copy`} /></label>
        <button type="submit">Save copy</button>
      </form>
    </details>
  );
}

function Document({ doc, busy, entry, tilesets }: { readonly doc: OpenDoc; readonly busy: boolean; readonly entry: LibraryEntry | undefined; readonly tilesets: AppView['tilesets'] }): ReactNode {
  const dirty = isDirty(doc.state);
  const locked = lockReason(doc) !== null;
  const ids = [...objectIds(doc.state.model)];
  return (
    <section className="document" aria-label={`Document ${doc.id}`}>
      <header>
        <h2>{mapName(doc.state.model)}</h2>
        <p className="identity"><code>{doc.id}</code> · <code>{doc.path}</code> · <span className={dirty ? 'dirty' : 'clean'}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
          <span className={doc.drafted ? "draft-status" : "draft-status reserved"} aria-hidden={!doc.drafted}> · <span>Draft kept in this browser</span></span></p>
      </header>
      {doc.readOnly && <p className="banner" role="note">Read-only: {doc.readOnly}</p>}
      {doc.draft && (
        <div className="banner" role="group" aria-label="Draft">
          <p>Unsaved draft from {new Date(doc.draft.updatedAt).toLocaleString()}. It is not saved, and editing waits until you restore or discard it. Safari can delete drafts of sites you have not used for a while.</p>
          <button type="button" onClick={() => void store.restoreDraft()}>Restore draft</button>
          <button type="button" onClick={() => void store.discardDraft()}>Discard draft</button>
        </div>
      )}
      {doc.torn && entry && entry.state !== 'ok' && <TornEntry entry={entry} />}
      {(doc.changedOnDisk || doc.conflicts.length > 0) && (
        <div className="banner bad" role="group" aria-label="Conflict">
          <p>{doc.path} changed on disk since it was opened. Save refuses to overwrite it: reload it, or keep editing and Save As a new map.</p>
          <button type="button" onClick={() => void store.reloadFromDisk(doc.id)}>Reload from disk</button>
        </div>
      )}
      <div className="commands" role="toolbar" aria-label="Document commands">
        <button type="button" disabled={!canUndo(doc.state) || locked} onClick={() => store.undo()}>Undo</button>
        <button type="button" disabled={!canRedo(doc.state) || locked} onClick={() => store.redo()}>Redo</button>
        <button type="button" disabled={busy || !dirty || locked} onClick={() => void store.save()}>Save</button>
        <button type="button" disabled={!dirty || !doc.savedModel || locked} onClick={() => store.askRevert()}>Revert…</button>
        <button type="button" onClick={() => void store.close(doc.id)}>Close</button>
      </div>
      {doc.confirmRevert && (
        <div className="banner" role="group" aria-label="Confirm revert">
          <p>Revert discards every unsaved change to {doc.path} and starts a fresh history.</p>
          <button type="button" onClick={() => store.confirmRevert()}>Revert to saved</button>
          <button type="button" onClick={() => store.cancelRevert()}>Cancel</button>
        </div>
      )}
      <NameField doc={doc} />
      {doc.readOnly === null && <SaveAs key={doc.id} doc={doc} />}
      {entry && entry.errors > 0
        ? <p className="note">Viewport unavailable while this map has validation errors; see Problems.</p>
        : <Viewport selection={store.selection(doc.id)} terrain={store.terrain(doc.id)} tilesets={tilesets} key={`viewport-${doc.id}`} model={doc.state.model} session={store.viewport(doc.id)} />}
      <SelectionPanel model={doc.state.model} session={store.selection(doc.id)} locked={locked} clipboard={() => store.clipboard} setClipboard={(text) => { store.clipboard = text; }} />
      <TerrainPanel key={`terrain-${doc.id}`} model={doc.state.model} session={store.terrain(doc.id)} selection={store.selection(doc.id)} locked={locked} />
      <GeometryPanel key={`geometry-${doc.id}`} model={doc.state.model} session={store.selection(doc.id)} locked={locked} />
      <Hierarchy ids={ids} model={doc.state.model} session={store.selection(doc.id)} />
    </section>
  );
}

export function App(): ReactNode {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useShortcuts();
  useEffect(() => { void store.start(); return () => store.dispose(); }, []);
  // Returning to the window re-reads the library, in case an outside change happened while the watcher could not see it.
  useEffect(() => {
    const again = (): void => { if (document.visibilityState === 'visible') void store.refresh(); };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  const active = view.docs.find((d) => d.id === view.activeId);
  return (
    <main>
      <header className="toolbar">
        <h1>MapLab</h1>
        <span className="library-name">{view.library ? `${view.library.label}${view.library.readOnly ? ' · read-only' : ''}` : 'No library'}</span>
        <p role="status" className="status">{view.status}</p>
      </header>
      {view.phase === 'offline' && <p className="banner">This page has no MapLab library server. Run <code>npm start</code> to open the library.</p>}
      {view.drafts === 'unavailable' && view.phase === 'ready' && <p className="note">Drafts are unavailable in this browser window, so unsaved edits are not journaled.</p>}
      {view.problems.length > 0 && <ul className="problems" aria-label="Problems">{view.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="workspace">
        <LibraryPanel view={view} />
        <div className="editor">
          {view.docs.length > 0 && (
            <nav className="tabs" aria-label="Open documents">
              {view.docs.map((d) => (
                <button type="button" key={d.id} aria-pressed={d.id === view.activeId} onClick={() => store.activate(d.id)}>{d.id}{isDirty(d.state) ? ' •' : ''}</button>
              ))}
            </nav>
          )}
          {active ? <Document doc={active} busy={view.busy} tilesets={view.tilesets} entry={view.library?.documents.find((e) => e.id === active.id)} /> : <p className="note">Open a map from the library.</p>}
        </div>
      </div>
    </main>
  );
}
