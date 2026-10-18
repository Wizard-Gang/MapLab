// SHA-256 digests of library bytes through Web Crypto, available in both Node and the browser. Pure.

const encoder = new TextEncoder();

/** Lowercase hex SHA-256 of `bytes`, or of the UTF-8 encoding of a string. */
export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? encoder.encode(bytes) : bytes;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const utf8Bytes = (text: string): Uint8Array => encoder.encode(text);
