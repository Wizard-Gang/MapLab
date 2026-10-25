// Classic ZIP v1: STORE only, fixed DOS date, UTF-8, regular files, no extras/comments.
// The reader validates both headers before slicing data; it never decompresses or extracts paths.
import { checkSafePath, pathAliasKey } from '../contracts/grammar';
export const ZIP_LIMITS = Object.freeze({ bytes: 512 * 1024 * 1024, files: 20_000 });
export class BundleError extends Error { constructor(readonly code: string, message: string) { super(message); } }
export function refuse(code: string, message: string): never { throw new BundleError(code, message); }
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function checkPaths(paths: readonly string[]): void {
  if (!paths.length || paths.length > ZIP_LIMITS.files) refuse('zip.limit', 'Archive file count is outside v1 limits');
  const aliases = new Set<string>();
  const files = new Set(paths.map(pathAliasKey));
  for (const p of paths) {
    if (checkSafePath(p) || p.split('/').length > 16 || /\.(zip|jar|7z|rar|tar|gz|tgz|bz2|xz)$/i.test(p)) refuse('zip.path', `Unsafe or nested archive path: ${p}`);
    const alias = pathAliasKey(p);
    if (aliases.has(alias)) refuse('zip.duplicate', `Duplicate or aliased path: ${p}`);
    aliases.add(alias);
    const parts = alias.split('/');
    for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join('/'))) refuse('zip.path', 'A file aliases a directory');
  }
}
const TABLE = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = TABLE[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function storeZip(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const paths = [...files.keys()].sort(compare); checkPaths(paths);
  const total = paths.reduce((n, p) => n + files.get(p)!.length + 76 + 2 * p.length, 22);
  if (total >= ZIP_LIMITS.bytes) refuse('zip.limit', 'Archive must be below 512 MiB');
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const path of paths) {
    const data = files.get(path)!, name = Buffer.from(path), crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x800, 6); l.writeUInt16LE(33, 12);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, name, Buffer.from(data)); central.push(c, name); offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export function readStoreZip(input: Uint8Array, options: { readonly allowUnsorted?: boolean } = {}): Map<string, Uint8Array> {
  if (input.length < 22 || input.length >= ZIP_LIMITS.bytes) refuse('zip.limit', 'Archive length is outside v1 limits');
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength), e = b.length - 22;
  if (b.readUInt32LE(e) !== 0x06054b50 || b.readUInt16LE(e + 4) || b.readUInt16LE(e + 6) || b.readUInt16LE(e + 20)) refuse('zip.end', 'Invalid ZIP end record');
  const count = b.readUInt16LE(e + 10), size = b.readUInt32LE(e + 12), start = b.readUInt32LE(e + 16);
  if (!count || count > ZIP_LIMITS.files || b.readUInt16LE(e + 8) !== count || start + size !== e) refuse('zip.limit', 'Invalid ZIP inventory or directory bounds');
  const files = new Map<string, Uint8Array>(), paths: string[] = []; let c = start, local = 0, total = 0;
  const range = (at: number, n: number, end: number): void => { if (at < 0 || at + n > end) refuse('zip.bounds', 'ZIP structure exceeds bounds'); };
  for (let i = 0; i < count; i++) {
    range(c, 46, e);
    if (b.readUInt32LE(c) !== 0x02014b50 || b.readUInt16LE(c + 4) !== 20 || b.readUInt16LE(c + 6) !== 20 || b.readUInt16LE(c + 8) !== 0x800 || b.readUInt16LE(c + 10) || b.readUInt16LE(c + 12) || b.readUInt16LE(c + 14) !== 33 || b.readUInt16LE(c + 30) || b.readUInt16LE(c + 32) || b.readUInt16LE(c + 34) || b.readUInt16LE(c + 36) || b.readUInt32LE(c + 38)) refuse('zip.metadata', 'Only canonical STORE regular files are supported');
    const n = b.readUInt16LE(c + 28), length = b.readUInt32LE(c + 24), crc = b.readUInt32LE(c + 16);
    if (length !== b.readUInt32LE(c + 20) || b.readUInt32LE(c + 42) !== local) refuse('zip.size', 'Compressed/expanded lengths or local offset differ');
    total += length; if (total >= ZIP_LIMITS.bytes) refuse('zip.limit', 'Expansion exceeds v1 limits');
    range(c + 46, n, e); range(local, 30, start);
    const name = b.subarray(c + 46, c + 46 + n), path = name.toString('utf8');
    if (!Buffer.from(path).equals(name)) refuse('zip.path', 'Invalid UTF-8 path');
    paths.push(path);
    if (!options.allowUnsorted && i && compare(paths[i - 1]!, path) >= 0) refuse('zip.duplicate', 'Entry paths must be unique and lexical');
    if (b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(local + 4) !== 20 || b.readUInt16LE(local + 6) !== 0x800 || b.readUInt16LE(local + 8) || b.readUInt16LE(local + 10) || b.readUInt16LE(local + 12) !== 33 || b.readUInt32LE(local + 14) !== crc || b.readUInt32LE(local + 18) !== length || b.readUInt32LE(local + 22) !== length || b.readUInt16LE(local + 26) !== n || b.readUInt16LE(local + 28)) refuse('zip.local', 'Local and central records disagree');
    range(local + 30, n + length, start);
    if (!b.subarray(local + 30, local + 30 + n).equals(name)) refuse('zip.local', 'Local filename differs');
    const data = b.subarray(local + 30 + n, local + 30 + n + length);
    if (crc32(data) !== crc) refuse('zip.crc', 'ZIP CRC-32 differs');
    files.set(path, data); local += 30 + n + length; c += 46 + n;
  }
  if (c !== e || local !== start) refuse('zip.bounds', 'Unaccounted ZIP bytes');
  checkPaths(paths); return files;
}
