// G1 steps 3–4 for verified bytes: exact format/contract negotiation, closed-schema validation and
// dependency closure. Reference resolution lives in resolve.mjs. Constructs nothing.
import { jcs, parseStrict } from './json.mjs';
import { validate } from './schema.mjs';

/** Exact versions this reader accepts (F7: never `version <= latest`). Prefabs never ship in exports (F4). */
export const SUPPORTED_FORMATS = Object.freeze(['maplab.catalog@1', 'maplab.map@1', 'maplab.movement@1', 'maplab.tileset@1']);
export const SUPPORTED_CONTRACTS = Object.freeze(['riglab.export@1','riglab.rig@1','riglab.anim@3','riglab.baked@1','riglab.weapon@1','maplab.camera@1', 'maplab.catalog@1', 'maplab.climb@1', 'maplab.collision@1',
  'maplab.map@1', 'maplab.movement@1', 'maplab.reference-controller@1', 'maplab.reference-grapple@1', 'maplab.tileset@1',
  // ML-016: exact vocabulary understood by this data-only proof consumer. Planned entries
  // remain configured, not simulated; no gameplay handler is executed here.
  'enemy.slime@1', 'enemy.bat@1', 'enemy.forest-guardian@1', 'npc.ranger@1', 'chest.wooden@1',
  'core.ledge.climb@1', 'core.patrol@1', 'core.guard@1', 'core.idle@1', 'core.encounter.activate@1', 'core.encounter.cleared@1',
  'core.flag.set@1', 'core.body.set-enabled@1', 'core.checkpoint.activate@1', 'core.chest.open@1',
  'core.respawn-at-checkpoint@1', 'core.camera.shake.small@1', 'core.env.fireflies@1', 'core.env.tint@1']);
/** The contracts each `{key, version}` member may bind, by document format and member name (F1). A supported
 * contract outside its role (a camera model naming `maplab.collision`) is unsupported for that role. */
export const CONTRACT_ROLES = Object.freeze({
  'maplab.map': Object.freeze({
    requiredFeatures: ['maplab.camera@1', 'maplab.climb@1', 'maplab.collision@1', 'maplab.reference-controller@1'],
    collisionContract: ['maplab.collision@1'],
    model: ['maplab.camera@1'],
  }),
  'maplab.movement': Object.freeze({ controller: ['maplab.reference-controller@1'] }),
});
/** `{key, version}` members, by member name, that name a semantic contract the consumer must support. */
export const CONTRACT_MEMBERS = new Set(Object.values(CONTRACT_ROLES).flatMap((roles) => Object.keys(roles)));

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isContractRef = (v) => isObject(v) && Object.keys(v).sort().join() === 'key,version' && typeof v.key === 'string' && Number.isInteger(v.version);
export const pathOf = (segments) => '$' + segments.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('');

/** Depth-first visit of every object with its JSON path, nearest member name (arrays inherit it) and a
 * context. `visit` returns `false` to skip the object's members, or the context for its members. Members
 * of the root object additionally receive `collection` (their own name). */
export function scan(value, visit, initial = {}) {
  const go = (v, at, name, ctx) => {
    if (Array.isArray(v)) { v.forEach((x, i) => go(x, [...at, i], name, ctx)); return; }
    if (!isObject(v)) return;
    const next = visit(v, at, name, ctx);
    if (next === false) return;
    for (const [k, x] of Object.entries(v)) go(x, [...at, k], k, at.length === 0 ? { ...next, collection: k } : next);
  };
  go(value, [], null, initial);
}

/** Parses, negotiates and schema-checks every manifest document. Returns Map id → {entry, value}. */
export function loadDocuments(manifest, files, schemas, diagnostics) {
  const docs = new Map();
  const report = (code, file, path, message) => diagnostics.push({ code, file, path, message });
  const declared = new Set();
  manifest.requiredContracts.forEach((c, i) => {
    const id = `${c.key}@${c.version}`;
    if (declared.has(id)) report('contract.duplicate', 'manifest.json', `$.requiredContracts[${i}]`, `${id} is declared twice`);
    declared.add(id);
    if (!SUPPORTED_CONTRACTS.includes(id)) report('contract.unsupported', 'manifest.json', '$.requiredContracts', `Unsupported required contract ${id}`);
  });
  if (manifest.externalMaps.length) report('contract.external-maps', 'manifest.json', '$.externalMaps', 'External-map bundles are deferred; this reader accepts closed bundles only');
  const required = new Set();
  for (const entry of manifest.documents) {
    const bytes = files.get(entry.path);
    let value;
    try { value = parseStrict(bytes); } catch (e) { report(e.code, entry.path, e.path, e.message); continue; }
    const identity = `${value?.format}@${value?.version}`;
    if (!SUPPORTED_FORMATS.includes(identity)) {
      const known = SUPPORTED_FORMATS.some((f) => f.startsWith(`${value?.format}@`));
      report(known ? 'document.version' : 'document.unsupported-format', entry.path, known ? '$.version' : '$.format', `Unsupported document ${identity}`);
      continue;
    }
    if (value.id !== entry.id || value.format !== entry.format || value.version !== entry.version) report('manifest.document-identity', entry.path, '$', `Manifest entry ${entry.id} disagrees with the document`);
    if (!declared.has(identity)) report('contract.undeclared', 'manifest.json', '$.requiredContracts', `${identity} is not declared`);
    if (Buffer.compare(Buffer.from(jcs(value), 'utf8'), bytes) !== 0) report('document.canonical', entry.path, '$', 'Export bytes are not RFC 8785 canonical');
    const violations = validate(schemas.get(identity), value);
    for (const v of violations) report(`schema.${v.keyword}`, entry.path, v.path, `Violates ${identity}`);
    if (violations.length) continue;
    const roles = CONTRACT_ROLES[value.format] ?? {};
    const features = new Set();
    scan(value, (v, at, name) => {
      if (!isContractRef(v) || !CONTRACT_MEMBERS.has(name)) return {};
      const id = `${v.key}@${v.version}`;
      if (!SUPPORTED_CONTRACTS.includes(id)) report('contract.unsupported', entry.path, pathOf(at), `Unsupported contract ${id}`);
      else if (!roles[name]?.includes(id)) report('contract.role', entry.path, pathOf(at), `${id} cannot bind ${name}`);
      else required.add(id);
      if (name === 'requiredFeatures') {
        if (features.has(v.key)) report('contract.duplicate', entry.path, pathOf(at), `${v.key} is required twice`);
        features.add(v.key);
      }
      return false;
    });
    docs.set(entry.id, { entry, value });
  }
  // F6: requiredContracts names every semantic contract a bundled document requires.
  for (const c of [...required].sort()) if (!declared.has(c)) report('contract.undeclared', 'manifest.json', '$.requiredContracts', `${c} is required by a document but not declared`);
  return docs;
}

/** Bundled dependency edges per document (absent optional dependencies omitted). */
export function dependencyEdges(docs) {
  return new Map([...docs].map(([id, { value }]) => [id, (value.dependencies ?? []).map((d) => d.id).filter((d) => docs.has(d))]));
}

/** Transitive dependency closure of `start`, including itself. */
export function closureOf(edges, start) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) for (const n of edges.get(stack.pop()) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  return seen;
}

/** Dependency closure from the entry map: identity, presence, uniqueness, reachability and non-map cycles. */
export function checkClosure(manifest, docs, diagnostics) {
  const report = (code, file, path, message) => diagnostics.push({ code, file, path, message });
  const entry = docs.get(manifest.entryMapId);
  if (entry?.value.format !== 'maplab.map') { report('closure.entry', 'manifest.json', '$.entryMapId', 'entryMapId must name a bundled map'); return; }
  const paths = new Map([...docs].map(([id, d]) => [id, d.entry.path]));
  const owners = new Map([...docs].map(([id, d]) => [d.entry.path.toLowerCase(), id]));
  for (const { entry: e, value } of docs.values()) {
    const seen = new Set();
    (value.dependencies ?? []).forEach((dep, i) => {
      const at = `$.dependencies[${i}]`;
      if (seen.has(dep.id)) report('dependency.duplicate', e.path, at, `Dependency ${dep.id} is listed twice`);
      seen.add(dep.id);
      const target = docs.get(dep.id);
      if (!target) {
        if (dep.required) { report('dependency.missing', e.path, at, `Required dependency ${dep.id} is not in the bundle`); return; }
        // An absent optional dependency still names one file: one path per ID, one ID per case-folded path.
        const known = paths.get(dep.id), owner = owners.get(dep.path.toLowerCase());
        if (known !== undefined && known !== dep.path) report('dependency.path-identity', e.path, `${at}.path`, `${dep.id} is listed with another path, ${known}`);
        else if (owner !== undefined && owner !== dep.id) report('dependency.path-alias', e.path, `${at}.path`, `${dep.path} aliases the file of ${owner}`);
        paths.set(dep.id, known ?? dep.path);
        owners.set(dep.path.toLowerCase(), owner ?? dep.id);
        return;
      }
      if (target.entry.path !== dep.path || target.value.format !== `maplab.${dep.kind}`) report('dependency.identity', e.path, at, `Dependency ${dep.id} disagrees with the bundled document`);
    });
  }
  const edges = dependencyEdges(docs);
  const closure = closureOf(edges, manifest.entryMapId);
  for (const [id, { entry: e }] of docs) if (!closure.has(id)) report('closure.unreachable', 'manifest.json', '$.documents', `${e.path} is outside the entry map's dependency closure`);
  for (const [id, { entry: e, value }] of docs) {
    if (value.format === 'maplab.map') continue;
    for (const to of edges.get(id)) if (closureOf(edges, to).has(id)) report('dependency.cycle', e.path, '$.dependencies', `Non-map document ${id} is on a dependency cycle`);
  }
}
