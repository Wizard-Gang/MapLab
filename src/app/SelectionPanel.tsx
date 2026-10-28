import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { moveSelection, numericEdit, numericLeaves, recordOf, type ObjectKey } from '../editor/editing';
import type { MapModel } from '../domain/model';
import type { SelectionSession } from '../editor/selection';
import { PICK_MODES } from '../render/picking';
import { setOp, transaction } from '../domain/commands';

export function SelectionPanel({ model, session, locked, clipboard, setClipboard }: { readonly model: MapModel; readonly session: SelectionSession; readonly locked: boolean; readonly clipboard: () => string; readonly setClipboard: (text: string) => void }): ReactNode {
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [text, setText] = useState(''), [target, setTarget] = useState('');
  const [dx, setDx] = useState('32'), [dy, setDy] = useState('0');
  const key = s.keys.length === 1 ? s.keys[0] : undefined, record = key ? recordOf(model, key) : undefined;
  const refs = session.references();
  const copy = (): void => {
    const value = session.copy(); setClipboard(value); setText(value); session.message('Copied versioned MapLab clipboard; paste here or in another open map');
    // The in-app clipboard is always available, including denied browser clipboard permissions.
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(value).catch(() => {});
  };
  return <section aria-label="Selection editor" className="selection-panel">
    <div role="toolbar" aria-label="Selection commands" className="commands">
      <label>Pick mode <select aria-label="Pick mode" value={s.mode} onChange={(e) => session.mode(e.target.value as typeof s.mode)}>{PICK_MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
      <button type="button" disabled={!s.keys.length} onClick={copy}>Copy objects</button>
      <button type="button" disabled={locked} onClick={() => session.paste(clipboard())}>Paste objects</button>
      <button type="button" disabled={locked || !s.keys.length} onClick={() => session.duplicate()}>Duplicate objects</button>
      <button type="button" disabled={locked || !s.keys.length} onClick={() => session.askDelete()}>Delete objects…</button>
      <button type="button" onClick={() => session.escape()}>Clear selection</button>
    </div>
    <form aria-label="Move selection" onSubmit={(e) => { e.preventDefault(); if (dx.trim() && dy.trim()) session.run(() => moveSelection(model, s.keys, [Number(dx), Number(dy)])); }}>
      <div className="commands"><label>Move X (WU)<input type="number" step={0.0625} value={dx} onChange={(e) => setDx(e.target.value)} /></label><label>Move Y (WU)<input type="number" step={0.0625} value={dy} onChange={(e) => setDy(e.target.value)} /></label><button type="submit" disabled={locked || !s.keys.length}>Move selection</button></div>
    </form>
    <p aria-label="Selection count">{s.keys.length} selected{s.keys.length ? `: ${s.keys.map((k) => k.id).join(', ')}` : ''}</p>
    <p role="note" aria-label="Edit notice">{s.message}</p>
    {s.deleting && <div className="banner" role="group" aria-label="Delete reference report">
      <p>Delete {s.deleting.map((k) => k.id).join(', ')}? {refs.length} dependent reference(s).</p>
      <ul>{refs.map((r, i) => <li key={i}>{r.path} → {r.id}</li>)}</ul>
      <button type="button" onClick={() => session.cancelDelete()}>Cancel deletion</button>
      {!refs.length && <button type="button" onClick={() => session.delete()}>{s.cascadePreview ? 'Confirm cascade deletion' : 'Confirm deletion'}</button>}
      {refs.length > 0 && <>
        <button type="button" onClick={() => session.previewCascade()}>Preview cascade</button>
        {s.deleting.length === 1 && <><label>Retarget dependent references to <select aria-label="Retarget dependent references to" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose surviving object</option>{model.collections.get(s.deleting[0]!.collection)?.order.filter((id) => id !== s.deleting![0]!.id).map((id) => <option key={id}>{id}</option>)}</select></label><button type="button" disabled={!target} onClick={() => session.delete(target)}>Retarget and delete</button></>}
      </>}
    </div>}
    {record && key && <fieldset disabled={locked} aria-label="Numeric inspector">
      <legend>Inspector: {key.id}</legend>
      {typeof record.name === 'string' && <label>Object name <input key={`${key.id}/${record.name}`} defaultValue={record.name} onBlur={(e) => { session.run(() => transaction('Rename object', [setOp(model, key.collection, key.id, 'name', e.target.value)])); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = record.name as string; e.currentTarget.blur(); } }} /></label>}
      <div className="numeric-fields">{numericLeaves(record).map(({ path, value }) => {
        const label = path.join('.');
        return <label key={`${key.id}/${label}/${value}`}>{label}<input aria-label={`Property ${label}`} type="number" step="any" defaultValue={value} onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value.trim() === '' || !Number.isFinite(n)) { session.message('Enter a finite number'); e.target.value = String(value); return; }
          if (n !== value && !session.run(() => numericEdit(model, key, path, n))) e.target.value = String(value);
        }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = String(value); e.currentTarget.blur(); } }} /></label>;
      })}</div>
    </fieldset>}
    <details><summary>Clipboard document / explicit reference repair</summary>
      <p className="note">Version 1 MapLab JSON. Paste external clipboard text here. Missing references block edits; replace the reported reference IDs with compatible target IDs before applying.</p>
      <textarea aria-label="Clipboard document" value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      <button type="button" disabled={locked || !text} onClick={() => { setClipboard(text); session.paste(text); }}>Apply clipboard document</button>
    </details>
  </section>;
}

function HierarchyCollection({collection,list,model,session,search,selected}:{readonly collection:string;readonly list:readonly string[];readonly model:MapModel;readonly session:SelectionSession;readonly search:string;readonly selected:ReadonlySet<string>}):ReactNode {
  const [expanded,setExpanded]=useState(false),[page,setPage]=useState(0),open=Boolean(search)||expanded;
  const records=model.collections.get(collection as never);
  const matches=useMemo(()=>open?[...list].sort().filter(id=>`${id} ${records?.byId.get(id)?.name??''}`.toLowerCase().includes(search)):[],[open,list,records,search]);
  const last=Math.max(0,Math.ceil(matches.length/200)-1),at=Math.min(page,last),visible=matches.slice(at*200,(at+1)*200);
  return <details open={open} onToggle={e=>setExpanded(e.currentTarget.open)}>
    <summary>{collection} ({list.length})</summary>
    {open&&<><ul data-collection={collection} onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const buttons = [...e.currentTarget.querySelectorAll('button')], i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const at = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        buttons[at]?.focus(); e.preventDefault();
      }}>{visible.map((id) => {
        const r = records?.byId.get(id), parent = r?.parentId ?? r?.layerId ?? r?.ownerBodyId;
        return <li key={id}><button type="button" aria-label={`Select ${id}`} aria-pressed={selected.has(id)} onClick={(e) => session.select([{ collection, id } as ObjectKey], e.shiftKey)}><code>{id}</code>{r?.name ? ` · ${r.name}` : ''}</button>{typeof parent === 'string' && <small> in {parent}</small>}</li>;
      })}</ul>{last>0&&<nav aria-label={`${collection} pages`}>
        <button type="button" disabled={at===0} onClick={()=>setPage(at-1)}>Previous {collection} page</button>
        <span> {at+1} / {last+1} · {matches.length} matches </span>
        <button type="button" disabled={at===last} onClick={()=>setPage(at+1)}>Next {collection} page</button>
      </nav>}</>}
  </details>;
}

export function Hierarchy({ ids, model, session }: { readonly ids: readonly (readonly [string, readonly string[]])[]; readonly model: MapModel; readonly session: SelectionSession }): ReactNode {
  const s=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot),[query,setQuery]=useState('');
  const selected=new Set(s.keys.map(k=>k.id)),search=query.trim().toLowerCase();
  return <section aria-label="Objects"><h3>Objects</h3><label>Hierarchy search <input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    {ids.map(([collection,list])=><HierarchyCollection key={`${collection}/${search}`} collection={collection} list={list} model={model} session={session} search={search} selected={selected}/>)}
  </section>;
}
