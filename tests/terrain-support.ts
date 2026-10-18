// Shared harness for the ML-013 terrain tests: the owned fixture, the R1 forest map and a terrain session wired to a
// plain document history, the way LibraryStore wires it, so each gesture is driven exactly as the viewport drives it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { validateSourceGraph, type Cell, type JsonValue, type TilesetDocument, type Vec2 } from '../src/contracts';
import { denormalize, type MapModel } from '../src/domain/model';
import type { PaintDelta } from '../src/domain/paint';
import { commit, openDocument, type DocumentState } from '../src/editor/history';
import { gridOf, type CellXY, type TerrainTool } from '../src/editor/terrain';
import { TerrainSession } from '../src/editor/terrain-session';
import { forestDocument, modelOf, root } from './history-support';

export const fixture = JSON.parse(readFileSync(join(root, 'conformance/terrain/cases.json'), 'utf8'));
export const LAYER: string = fixture.base.layerId;
export const tileset = JSON.parse(readFileSync(join(root, 'placeholder-library/tilesets/forest.tileset.json'), 'utf8')) as TilesetDocument;
export const plain = (tileId: string): Cell => ({ tileId, quarterTurns: 0, mirrorX: false, mirrorY: false });

/** The R1 forest map, optionally with other bounds (fills are bounded by them). */
export function forest(bounds?: readonly number[]): MapModel {
  const doc = forestDocument() as Record<string, JsonValue>;
  return modelOf(bounds ? { ...doc, bounds: [...bounds] } : doc);
}
/** The world point at the centre of a cell of the fixture layer. */
export function centre(m: MapModel, [c, r]: CellXY): Vec2 {
  const g = gridOf(m.terrain!.byLayer.get(LAYER)!);
  return [g.origin[0] + (c + 0.5) * g.cellSize[0], g.origin[1] + (r + 0.5) * g.cellSize[1]];
}

export class Harness {
  state: DocumentState;
  readonly session: TerrainSession;
  readonly queued: (() => void)[] = [];
  constructor(m: MapModel, options: { readonly budget?: number; readonly deferred?: boolean } = {}) {
    this.state = openDocument(m, { savedDigest: 'disk-0', ...(options.budget ? { budget: options.budget } : {}) });
    this.session = new TerrainSession(() => this.state.model, (id) => (id === tileset.id ? tileset : undefined),
      (tx) => { const r = commit(this.state, tx); if (r.outcome === 'refused') return false; this.state = r.state; return true; },
      () => true, options.deferred ? (run) => { this.queued.push(run); } : (run) => run());
  }
  /** Pointer-down at the first cell, moves through the rest; release unless `release` is false. */
  gesture(tool: TerrainTool, tile: Cell | string | null, path: readonly CellXY[], release = true): boolean {
    this.session.tool(tool);
    if (tile !== null) this.session.choose(typeof tile === 'string' ? plain(tile) : tile);
    if (!this.session.down(centre(this.state.model, path[0]!))) return false;
    for (const p of path.slice(1)) this.session.move(centre(this.state.model, p));
    if (release) this.session.end();
    return true;
  }
  /** The newest history entry's single paint delta. */
  lastDelta(): PaintDelta {
    const op = this.state.past.at(-1)?.tx.ops;
    expect(op).toHaveLength(1);
    if (op?.[0]?.op !== 'paint') throw new Error('expected one paint operation');
    return op[0].delta;
  }
}

/** Every library source with `model` in place of its map: the same full graph validation LibraryStore runs per command. */
export function graphErrors(model: MapModel): string[] {
  const dirs = ['maps', 'movement', 'catalogs', 'tilesets', 'prefabs'];
  const inputs = dirs.flatMap((dir) => readdirSync(join(root, 'placeholder-library', dir)).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(root, 'placeholder-library', dir, f), 'utf8')) as Record<string, JsonValue>));
  return validateSourceGraph(inputs.map((d) => (d.id === model.id ? denormalize(model) : d)) as JsonValue[]).diagnostics
    .filter((d) => d.severity === 'error').map((d) => `${d.jsonPath}: ${d.message}`);
}
