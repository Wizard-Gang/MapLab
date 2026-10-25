import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { parseJson, type Layer } from '../contracts';
import type { PrefabDocument } from '../contracts/document-types';
import { applyPrefab, createPrefab } from '../editor/prefabs';
import { allocateId } from '../domain/remap';
import { records } from '../render/scene';
import { lockReason, type LibraryStore, type OpenDoc } from './store';
export function PrefabPanel({ store, doc }: { readonly store: LibraryStore; readonly doc: OpenDoc }): ReactNode {
  const session = store.selection(doc.id), selection = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [sourceId, setSource] = useState(''), [newId, setNewId] = useState('prefab.selection'), [name, setName] = useState('Reusable content');
  const [x, setX] = useState('0'), [y, setY] = useState('0'), [mirror, setMirror] = useState(false), [bindings, setBindings] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<{ id: string; digest: string; text: string } | null>(null), [notice, setNotice] = useState('');
  const view = store.getSnapshot(), templates = store.prefabSources(), prefab = templates.find(p => p.id === sourceId) ?? templates[0];
  const model = doc.state.model, layers = records<Layer>(model, 'layers').filter(l => l.kind !== 'group');
  const locked = !!lockReason(doc) || view.busy || !!view.library?.readOnly;
  const run = async (work: () => void | Promise<void>): Promise<void> => { try { await work(); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } };
  const point = (): readonly [number, number] => { const p = [Number(x), Number(y)] as const; if (p.some(n => !Number.isFinite(n) || n * 16 !== Math.round(n * 16))) throw Error('Coordinates must use 1/16 WU'); return p; };
  return <details><summary>Prefabs</summary><fieldset disabled={locked} aria-label="Prefab authoring">
    <label>New prefab ID<input aria-label="New prefab ID" value={newId} onChange={e => setNewId(e.target.value)} /></label>
    <label>Prefab name<input aria-label="Prefab name" value={name} onChange={e => setName(e.target.value)} /></label>
    <button type="button" disabled={!selection.keys.length} onClick={() => void run(async () => {
      if (view.library?.documents.some(d => d.id === newId)) throw Error('Choose an unused prefab ID');
      const created = createPrefab(model, selection.keys, newId, name, point(), store.gameplaySources());
      if (await store.savePrefab(created, null)) { setSource(created.id); setBindings({}); setNotice(`Created ${created.id} from selection and its reference closure`); }
    })}>Create prefab from selection</button>
    <label>Prefab template<select aria-label="Prefab template" value={prefab?.id ?? ''} onChange={e => { setSource(e.target.value); setBindings({}); setDraft(null); }}>{templates.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Prefab X / pivot X<input aria-label="Prefab X" value={x} onChange={e => setX(e.target.value)} /></label>
    <label>Prefab Y / pivot Y<input aria-label="Prefab Y" value={y} onChange={e => setY(e.target.value)} /></label>
    <label className="inline">Mirror prefab X<input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} /></label>
    {prefab?.layerSlots.map(slot => <label key={slot}>Bind {slot}<select aria-label={`Bind prefab slot ${slot}`} value={bindings[slot] ?? ''} onChange={e => setBindings({ ...bindings, [slot]: e.target.value })}><option value="">Choose layer</option>{layers.map(l => <option key={l.id} value={l.id}>{l.name} ({l.kind})</option>)}</select></label>)}
    <button type="button" disabled={!prefab} onClick={() => void run(() => {
      if (!prefab) return;
      const taken = (id: string): boolean => model.owners.has(id) || model.groups.has(id), base = 'pp.prefab', id = taken(base) ? allocateId(base, taken) : base;
      const entry = view.library?.documents.find(d => d.id === prefab.id); if (!entry) throw Error('Prefab is not saved');
      const tx = applyPrefab(model, prefab, { id, position: point(), mirrorX: mirror, layerBindings: prefab.layerSlots.map(slot => ({ slot, layerId: bindings[slot] ?? '' })), prefabPath: entry.path });
      if (store.edit(doc.id, tx)) setNotice(`Placed ${id}; edit expanded objects independently and undo as one command`);
    })}>Place prefab</button>
    <button type="button" disabled={!prefab} onClick={() => {
      const entry = view.library?.documents.find(d => d.id === prefab?.id);
      if (prefab && entry?.digest) setDraft({ id: prefab.id, digest: entry.digest, text: JSON.stringify(prefab, null, 2) });
    }}>Edit prefab source</button>
    {draft && <><label>Prefab source JSON<textarea aria-label="Prefab source JSON" value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label><button type="button" onClick={() => void run(async () => {
      const parsed = parseJson(draft.text); if (!parsed.ok) throw Error(parsed.diagnostic.message);
      const value = parsed.value as unknown as PrefabDocument;
      if (value.id !== draft.id || value.format !== 'maplab.prefab') throw Error('Keep the prefab identity');
      if (value.dependencies?.some(d => d.kind === 'prefab')) throw Error('Nested prefab dependencies are not supported');
      await store.savePrefab(value, draft.digest); setDraft(null); setNotice('Saved template; existing placements keep their edits');
    })}>Save prefab source</button><button type="button" onClick={() => setDraft(null)}>Discard prefab source draft</button></>}
  </fieldset><p aria-label="Prefab notice">{notice}</p>
    <ul aria-label="Prefab placements">{records<{ id: string; prefabId: string; expandedIds: string[] }>(model, 'prefabPlacements').map(p => <li key={p.id}><code>{p.id}</code> from <code>{p.prefabId}</code> ({p.expandedIds.length} expanded IDs)<button type="button" onClick={() => session.select([...model.collections].flatMap(([collection, c]) => collection === 'dependencies' ? [] : c.order.filter(id => p.expandedIds.includes(id)).map(id => ({ collection, id }))))}>Select {p.id} content</button></li>)}</ul>
  </details>;
}
