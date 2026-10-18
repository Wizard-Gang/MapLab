// The loopback request guard (adopted H4, R1 H4). It runs inside the plugin's own middleware, because
// Vite's host check runs too late to protect it. Only a POST from MapLab's own page, served on a
// loopback host, gets through; a DNS-rebound name, another site or a form post is refused. Pure.
import { ROUTE_PREFIX } from './protocol';

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/;
const JSON_TYPE = /^application\/json[ \t]*(?:;|$)/i;

export interface GuardRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}
export interface GuardRefusal { readonly status: number; readonly code: string; readonly message: string }

/** A header's only value; a repeated header is ambiguous, so it reads as absent and fails the check. */
const header = (r: GuardRequest, name: string): string | undefined => {
  const v = r.headers[name];
  return typeof v === 'string' ? v : undefined;
};

/** Why `request` may not reach a library endpoint, or null. */
export function guardRefusal(request: GuardRequest): GuardRefusal | null {
  const host = header(request, 'host');
  if (!host || !LOOPBACK_HOST.test(host)) return { status: 403, code: 'guard.host', message: 'Library endpoints answer only a loopback Host' };
  if (header(request, 'origin') !== `http://${host}`) return { status: 403, code: 'guard.origin', message: "Library endpoints answer only MapLab's own page (Origin must equal http://<Host>)" };
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return { status: 403, code: 'guard.site', message: 'Library endpoints answer only same-origin requests' };
  if (request.method !== 'POST') return { status: 405, code: 'guard.method', message: 'Library endpoints accept only POST' };
  if (!JSON_TYPE.test(header(request, 'content-type') ?? '')) return { status: 415, code: 'guard.content-type', message: 'Send library requests as application/json' };
  return null;
}

export const isLibraryUrl = (url: string | undefined): boolean => typeof url === 'string' && url.startsWith(ROUTE_PREFIX);
