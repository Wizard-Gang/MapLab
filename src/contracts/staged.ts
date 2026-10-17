// Compatibility for the explicit partial readers. Published schemas and the full graph
// reader always enforce the final contracts; partial readers return named deferred fields.
import type { JsonValue } from './json';
export function geometryStage(schema: JsonValue): JsonValue {
  const s = structuredClone(schema) as { [k: string]: JsonValue };
  const defs = s.$defs as { [k: string]: JsonValue };
  const content = defs['prefab-content'] as { properties: { [k: string]: JsonValue } } | undefined;
  defs['deferred-array'] = { type: 'array' };
  defs['deferred-object'] = { type: 'object' };
  const props = content?.properties ?? s.properties as { [k: string]: JsonValue };
  for (const name of ['presentations', 'flags', 'regions', 'entities', 'waypoints', 'routes', 'triggers', 'encounters']) {
    props[name] = { $ref: '#/$defs/deferred-array' };
  }
  for (const name of ['camera', 'environment', 'navigation']) if (name in props) props[name] = { $ref: '#/$defs/deferred-object' };
  defs.call = { type: 'object', properties: { key: { $ref: '#/$defs/key' }, version: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, params: { type: 'object' } }, required: ['key', 'version', 'params'], additionalProperties: false };
  defs.condition = { type: 'object' };
  return s;
}
