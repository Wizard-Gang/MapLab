import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { Rect, Vec2 } from '../contracts/common-types';
import type { MapModel } from '../domain/model';
import { OVERLAYS, type ViewportSession } from '../editor/viewport';
import { CanvasViewport } from '../render/canvas';
import { buildScene, mapBounds } from '../render/scene';
import { cssToWorld, snapWorld } from '../render/transform';

export function Viewport({ model, session }: { readonly model: MapModel; readonly session: ViewportSession }): ReactNode {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const scene = useMemo(() => buildScene(model), [model]);
  const host = useRef<HTMLDivElement>(null), art = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);
  const cursor = useRef<HTMLSpanElement>(null);
  const bounds = useRef<Rect>(mapBounds(model)); bounds.current = scene.bounds;
  const renderer = useRef<CanvasViewport | null>(null);
  useEffect(() => {
    const el = host.current, a = art.current, o = overlay.current;
    if (!el || !a || !o) return;
    const r = new CanvasViewport(a, o, scene, session.getSnapshot(), (text) => { if (notice.current) notice.current.textContent = text; }); renderer.current = r;
    const resize = new ResizeObserver(([entry]) => { if (entry) session.resize([entry.contentRect.width, entry.contentRect.height], bounds.current); });
    resize.observe(el);
    let resolution: MediaQueryList;
    const dpr = (): void => { resolution?.removeEventListener('change', dpr); r.invalidateDpr(); resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); resolution.addEventListener('change', dpr); };
    dpr();
    let space = false, captured: number | null = null;
    const position = (e: MouseEvent): Vec2 => { const rect = el.getBoundingClientRect(); return [e.clientX - rect.left, e.clientY - rect.top]; };
    const release = (cancel: boolean): void => {
      if (cancel) session.cancel(); else if (captured !== null) session.end(captured);
      const id = captured; captured = null;
      if (id !== null && el.hasPointerCapture(id)) el.releasePointerCapture(id);
      el.classList.remove('panning');
    };
    const down = (e: PointerEvent): void => {
      if (!e.isPrimary || captured !== null || !(e.button === 1 || (e.button === 0 && (space || session.getSnapshot().panTool)))) return;
      e.preventDefault(); el.focus({ preventScroll: true });
      session.begin(e.pointerId, position(e)); captured = e.pointerId; el.setPointerCapture(e.pointerId); el.classList.add('panning');
    };
    const move = (e: PointerEvent): void => {
      session.move(e.pointerId, position(e));
      const s = session.getSnapshot(), world = cssToWorld(s.view, position(e)), snapped = snapWorld(world, s.snap);
      if (cursor.current) cursor.current.textContent = `World ${world.map((v) => v.toFixed(4)).join(', ')} WU · ${s.snap.free ? 'Free → 1/16 WU' : 'Grid → 1/16 WU'}: ${snapped.join(', ')}`;
    };
    const up = (e: PointerEvent): void => { if (e.pointerId === captured) { session.move(e.pointerId, position(e)); release(false); } };
    const cancel = (e: PointerEvent): void => { if (e.pointerId === captured) release(true); };
    const blur = (): void => { space = false; release(true); };
    const keydown = (e: KeyboardEvent): void => {
      if (e.target !== el || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); space = true; }
      if (e.key === 'Escape') { e.preventDefault(); release(true); space = false; }
      const delta: Record<string, Vec2> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
      if (Object.hasOwn(delta, e.key)) { e.preventDefault(); session.pan(delta[e.key]!); }
    };
    const keyup = (e: KeyboardEvent): void => { if (e.code === 'Space') { e.preventDefault(); space = false; } };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (captured !== null) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? session.getSnapshot().size[1] : 1;
      if (e.ctrlKey || e.metaKey) session.zoom(position(e), session.getSnapshot().view.zoom * Math.exp(-e.deltaY * unit * 0.002));
      else session.pan(e.shiftKey && e.deltaX === 0 ? [-e.deltaY * unit, 0] : [-e.deltaX * unit, -e.deltaY * unit]);
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel); el.addEventListener('lostpointercapture', cancel); el.addEventListener('keydown', keydown); el.addEventListener('keyup', keyup);
    el.addEventListener('blur', blur); window.addEventListener('blur', blur); el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      release(true); resize.disconnect(); resolution.removeEventListener('change', dpr); r.dispose(); renderer.current = null;
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel); el.removeEventListener('lostpointercapture', cancel); el.removeEventListener('keydown', keydown); el.removeEventListener('keyup', keyup);
      el.removeEventListener('blur', blur); window.removeEventListener('blur', blur); el.removeEventListener('wheel', wheel);
    };
    // Model changes update the renderer below without replacing input handlers or camera state.
  }, [session]);
  useEffect(() => { renderer.current?.update(scene, state); }, [scene, state]);
  const center: Vec2 = [state.size[0] / 2, state.size[1] / 2];
  return (
    <section className="viewport-panel" aria-label="Map viewport">
      <div className="viewport-controls" role="toolbar" aria-label="View controls">
        <button type="button" onClick={() => session.fit(scene.bounds)}>Fit bounds</button>
        <button type="button" onClick={() => session.zoom(center, state.view.zoom / 1.25)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => session.zoom(center, state.view.zoom * 1.25)} aria-label="Zoom in">+</button>
        <button type="button" aria-pressed={state.panTool} onClick={() => session.panTool()}>Pan tool</button>
        <button type="button" aria-pressed={state.physicsFocus} onClick={() => session.focusPhysics()}>Physics focus</button>
        <span aria-label="View scale">{(state.view.zoom * 100).toFixed(1)}%</span>
      </div>
      <details className="overlay-controls">
        <summary>Overlays and snap</summary>
        <div className="overlay-toggles" role="group" aria-label="Overlays">
          {OVERLAYS.map((name) => <label key={name}><input type="checkbox" checked={state.overlays[name]} onChange={() => session.toggle(name)} />{name}</label>)}
        </div>
        <div className="overlay-toggles" role="group" aria-label="Art layers">
          {scene.art.map(({ layer }) => <label key={layer.id}><input type="checkbox" aria-label={`Art layer ${layer.name}`} checked={!state.hiddenLayers.has(layer.id)} disabled={!layer.visible} onChange={() => session.toggleLayer(layer.id)} />{layer.name}{!layer.visible ? ' (authored hidden)' : ''}</label>)}
        </div>
        <div className="snap-controls" role="group" aria-label="Snap settings">
          <label><input type="checkbox" checked={state.snap.free} onChange={() => session.snap({ ...state.snap, free: !state.snap.free })} />Free placement</label>
          {(['spacing', 'origin'] as const).flatMap((kind) => ([0, 1] as const).map((axis) => <label key={`${kind}${axis}`}>Snap {kind} {axis === 0 ? 'X' : 'Y'}
            <input type="number" step={0.0625} min={kind === 'spacing' ? 0.0625 : -131072} max={131072} defaultValue={state.snap[kind][axis]} onBlur={(e) => {
              const n = Number(e.target.value);
              if (e.target.value !== '' && e.target.validity.valid && Number.isFinite(n)) {
                const value = [...state.snap[kind]] as [number, number]; value[axis] = n; session.snap({ ...state.snap, [kind]: value });
              } else e.target.value = String(state.snap[kind][axis]);
            }} />
          </label>))}
        </div>
      </details>
      <p className="note" id={`view-help-${model.id}`}>Space + drag or middle drag to pan. Wheel pans; Ctrl/⌘ + wheel zooms at the pointer. Focus the viewport for arrow keys. Escape cancels a pan.</p>
      <div ref={host} className="viewport" tabIndex={0} role="group" aria-label="World canvas" aria-describedby={`view-help-${model.id}`}
        data-camera-x={state.view.camera[0]} data-camera-y={state.view.camera[1]} data-zoom={state.view.zoom} data-width={state.size[0]} data-height={state.size[1]}>
        <canvas ref={art} className="art-canvas" aria-label="Art canvas" />
        <canvas ref={overlay} className="overlay-canvas" aria-label="Overlay canvas" />
      </div>
      <span ref={cursor} className="note cursor" aria-label="World cursor">Move the pointer over the viewport for world and snap coordinates.</span>
      <p ref={notice} className="note" aria-label="Viewport notice" />
      <p className="note">Navigation shows authored intent; no generated routes yet. Camera and environment show authored zones. Asset references are markers until asset loading is available.</p>
    </section>
  );
}
