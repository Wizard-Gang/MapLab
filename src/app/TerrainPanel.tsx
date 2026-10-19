import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Cell } from '../contracts';
import type { MapModel } from '../domain/model';
import type { SelectionSession } from '../editor/selection';
import type { TerrainSession } from '../editor/terrain-session';
import { TERRAIN_TOOLS, palette, type TerrainTool } from '../editor/terrain';
import { TURNS, type Turn } from '../editor/terrain-rules';

const TOOL_NAMES: Readonly<Record<TerrainTool, string>> = { brush: 'Brush (B)', rect: 'Rectangle (R)', line: 'Line (L)', fill: 'Fill (F)', erase: 'Erase (E)', transform: 'Transform' };
const TURN_NAMES: Readonly<Record<Turn, string>> = { rotate: 'Rotate 90° clockwise', mirrorX: 'Mirror X', mirrorY: 'Mirror Y' };

/** Terrain mode controls (R1 C4): art-only status, active tile layer, tool, and the layer tileset's palette. */
export function TerrainPanel({ model, session, selection, locked }: { readonly model: MapModel; readonly session: TerrainSession; readonly selection: SelectionSession; readonly locked: boolean }): ReactNode {
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const mode = useSyncExternalStore(selection.subscribe, () => selection.getSnapshot().mode, () => selection.getSnapshot().mode);
  const layerId = session.layerId(model), tileset = session.tilesetOf(model);
  const tiles = useMemo(() => (tileset ? palette(tileset) : []), [tileset]);
  const layers = model.terrain?.order ?? [];
  const names = new Map((model.collections.get('layers')?.order ?? []).map((id) => [id, String(model.collections.get('layers')?.byId.get(id)?.name ?? id)]));
  const layer = layerId === null ? undefined : model.terrain?.byLayer.get(layerId);
  const occupied = useMemo(() => {
    let n = 0, chunks = 0, intent = 0;
    for (const c of layer?.cells.chunks.values() ?? []) { let k = 0; for (const v of c) if (v !== 0) k++; n += k; if (k) chunks++; }
    for (const c of layer?.intent.chunks.values() ?? []) for (const v of c) if (v !== 0) intent++;
    return { n, chunks, intent };
  }, [layer]);
  const seed = Number(layer?.settings.variationSeed ?? 0);
  const fallback = new Map(tiles.map((t) => [t.id, t.color]));
  const tile = s.tile && tiles.some((t) => t.id === s.tile!.tileId) ? s.tile : null, entry = tile ? tiles.find((t) => t.id === tile.tileId) : undefined;
  const pick = (next: Partial<Cell> & { tileId: string }): void => {
    const p = tiles.find((t) => t.id === next.tileId)!;
    const base: Cell = tile?.tileId === next.tileId ? tile : { tileId: next.tileId, quarterTurns: p.quarterTurns[0] ?? 0, mirrorX: false, mirrorY: false };
    session.choose({ ...base, ...next });
  };
  return <details className="selection-panel" open={mode === 'Terrain'}><summary>Terrain tools</summary>
    <p role="note" aria-label="Terrain status" className="badge">Art only: tile edits never change collision, footholds or navigation.</p>
    {mode !== 'Terrain' && <p className="note">Choose Terrain in Pick mode to paint in the viewport.</p>}
    {!layers.length ? <p className="note">This map has no terrain layer.</p> : <fieldset disabled={locked} aria-label="Terrain">
      <legend>Terrain layer {layerId}</legend>
      <label>Terrain layer <select aria-label="Terrain layer" value={layerId ?? ''} onChange={(e) => session.layer(e.target.value)}>
        {layers.map((id) => <option key={id} value={id}>{names.get(id) ?? id} ({id})</option>)}
      </select></label>
      <p aria-label="Terrain occupancy">{occupied.n} painted cell(s) in {occupied.chunks} chunk(s){tileset ? ` · tileset ${tileset.id}` : ''}</p>
      <p aria-label="Terrain intent">{occupied.intent} terrain intent cell(s) · rules version {String(layer?.settings.rulesVersion ?? '')}</p>
      <label>Paint <select aria-label="Paint mode" value={s.paint} onChange={(e) => session.mode(e.target.value as typeof s.paint)}>
        <option value="tiles">Tiles</option><option value="terrain">Terrain (autotile)</option>
      </select></label>
      <div className="commands" role="toolbar" aria-label="Terrain tool">
        {TERRAIN_TOOLS.map((t) => <button key={t} type="button" aria-pressed={s.tool === t} onClick={() => session.tool(t)}>{TOOL_NAMES[t]}</button>)}
      </div>
      {s.tool === 'transform' && <label>Transform <select aria-label="Transform kind" value={s.turn} onChange={(e) => session.turnKind(e.target.value as Turn)}>
        {TURNS.map((t) => <option key={t} value={t}>{TURN_NAMES[t]}</option>)}
      </select></label>}
      {!tileset ? <p className="note">This layer's tileset is not available in the library, so it cannot be painted.</p> : s.paint === 'terrain' ? <>
        <div className="commands palette" role="group" aria-label="Terrain palette">
          {tileset.terrains.map((t) => <button key={t.id} type="button" aria-label={`Terrain ${t.id}`} aria-pressed={s.terrainId === t.id} onClick={() => session.chooseTerrain(t.id)}>
            <span className="swatch" style={{ background: fallback.get(t.fallbackTileId) ?? '#7d8f88' }} />{t.name}
          </button>)}
        </div>
        <label>Variation seed <input key={`seed-${seed}`} aria-label="Variation seed" type="number" min={0} step={1} defaultValue={seed} onBlur={(e) => {
          const n = Number(e.target.value);
          if (n !== seed && !session.reseed(n)) e.target.value = String(seed);
        }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = String(seed); e.currentTarget.blur(); } }} /></label>
        <p className="note">Terrain paints intent; every painted cell and its eight neighbors resolve to explicit tiles in the same undo step.</p>
      </> : <>
        <div className="commands palette" role="group" aria-label="Tile palette">
          {tiles.map((t) => <button key={t.id} type="button" aria-label={`Tile ${t.id}`} aria-pressed={tile?.tileId === t.id} onClick={() => pick({ tileId: t.id })}>
            <span className="swatch" style={{ background: t.color ?? '#7d8f88' }} />{t.id}
          </button>)}
        </div>
        {entry && tile && <div className="commands" role="group" aria-label="Tile transform">
          <label>Quarter turns <select aria-label="Quarter turns" value={tile.quarterTurns} disabled={entry.quarterTurns.length < 2} onChange={(e) => pick({ tileId: tile.tileId, quarterTurns: Number(e.target.value) as Cell['quarterTurns'] })}>
            {entry.quarterTurns.map((q) => <option key={q} value={q}>{q * 90}°</option>)}
          </select></label>
          <label className="inline"><input type="checkbox" aria-label="Mirror X" checked={tile.mirrorX} disabled={!entry.mirrorX} onChange={(e) => pick({ tileId: tile.tileId, mirrorX: e.target.checked })} />Mirror X</label>
          <label className="inline"><input type="checkbox" aria-label="Mirror Y" checked={tile.mirrorY} disabled={!entry.mirrorY} onChange={(e) => pick({ tileId: tile.tileId, mirrorY: e.target.checked })} />Mirror Y</label>
        </div>}
      </>}
      <p role="note" aria-label="Terrain notice">{s.message}</p>
    </fieldset>}
  </details>;
}
