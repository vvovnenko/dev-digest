import * as dns from 'node:dns';
import * as https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { AppError, ExternalServiceError, ValidationError } from '../../platform/errors.js';

/**
 * An SSRF-safe https GET, for importing a skill from a URL.
 *
 * - https on the default port only, no credentials; every redirect hop is checked
 *   again, and at most `maxRedirects` are followed (by hand, never by a library).
 * - Public addresses only. The connection resolves its host through `guardedLookup`,
 *   which checks EVERY address the resolver returns at connect time, so a DNS answer
 *   that changes after a check (rebinding) can't reach a private address. Node skips
 *   `lookup` for an IP-literal host, so a literal is checked before connecting.
 * - One timeout for the whole chain, a hard byte cap on the streamed body, no
 *   compression (`accept-encoding: identity`), and an HTML page is refused.
 *
 * The skills module declares the same shape as its `SkillFileFetcher` port; this
 * adapter satisfies it structurally (like `PrDiffSource` and the reviews `DiffSource`).
 */

export interface FetchedFile {
  bytes: Uint8Array;
  /** The response's `content-type`, when it sent one. */
  contentType: string | null;
  /** The URL the bytes came from, after redirects. */
  finalUrl: URL;
}

export interface UrlFetcher {
  fetch(url: URL, limits: { maxBytes: number }): Promise<FetchedFile>;
}

// ---- addresses ----------------------------------------------------------------

/** Not reachable from the public internet, or not meant to be fetched from (RFC 6890 and friends). */
const BLOCKED_V4: readonly [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata endpoints)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];
const BLOCKED_V6: readonly [string, number][] = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible (deprecated; never a public destination)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentation
  ['100::', 64], // discard-only
];

const BLOCKED = new BlockList();
for (const [net, prefix] of BLOCKED_V4) BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of BLOCKED_V6) BLOCKED.addSubnet(net, prefix, 'ipv6');

/**
 * True when `ip` is a public unicast address. An IPv4-mapped (`::ffff:a.b.c.d`) or
 * NAT64 (`64:ff9b::/96`) address is judged by the IPv4 address it carries; anything
 * that is not an IP address is not public.
 */
export function isPublicAddress(ip: string): boolean {
  const bare = ip.replace(/^\[(.*)\]$/, '$1').replace(/%.*$/, '');
  try {
    const family = isIP(bare);
    if (family === 4) return !BLOCKED.check(bare, 'ipv4');
    if (family !== 6) return false;
    const v4 = embeddedIpv4(bare);
    return v4 !== null ? !BLOCKED.check(v4, 'ipv4') : !BLOCKED.check(bare, 'ipv6');
  } catch {
    return false;
  }
}

/** The IPv4 address inside an IPv4-mapped or NAT64 IPv6 address; null for any other. */
function embeddedIpv4(ip: string): string | null {
  const w = ipv6Words(ip);
  if (!w) return null;
  const zero = (from: number, to: number) => w.slice(from, to).every((x) => x === 0);
  const mapped = zero(0, 5) && w[5] === 0xffff;
  const nat64 = w[0] === 0x64 && w[1] === 0xff9b && zero(2, 6);
  if (!mapped && !nat64) return null;
  return [w[6]! >> 8, w[6]! & 0xff, w[7]! >> 8, w[7]! & 0xff].join('.');
}

/** A valid IPv6 address (`net.isIP` said so) → its eight 16-bit words. */
function ipv6Words(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const words = (part: string | undefined) => (part ? part.split(':').map((h) => parseInt(h, 16)) : []);
  const head = words(halves[0]);
  const tail = words(halves[1]);
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 0) return null;
  const all = [...head, ...new Array<number>(fill).fill(0), ...tail];
  return all.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? all : null;
}

// ---- lookup ---------------------------------------------------------------------

/** `dns.lookup` in the one form the guard calls it with. */
export type DnsLookup = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

/** The `lookup` signature `net.connect` (and so `https.request`) calls. */
export type LookupFunction = (
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) => void;

/**
 * A connect-time `lookup` that resolves every address and refuses the connection
 * when there is none or ANY of them is not public. It answers in the form Node
 * asked for: an array when `options.all` (Node 22's `autoSelectFamily` asks so),
 * else the first address and its family.
 */
export function guardedLookup(dnsLookup: DnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    const empty = options.all ? [] : '';
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, empty);
      const list = addresses ?? [];
      if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
        return callback(fetchErrors.blockedAddress(), empty);
      }
      if (options.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

// ---- errors ---------------------------------------------------------------------

/** What a fetch can fail with; `MockUrlFetcher` throws the same errors. */
export const fetchErrors = {
  blockedAddress: () =>
    new ValidationError('The URL points to a private or reserved address', { reason: 'blocked_address' }),
  insecureRedirect: () =>
    new ValidationError('The URL redirected to a non-https address, another port or one with credentials', {
      reason: 'insecure_redirect',
    }),
  tooManyRedirects: (max: number) =>
    new ValidationError(`The URL redirected more than ${max} times`, { reason: 'too_many_redirects' }),
  htmlPage: () => new ValidationError('The URL returned a web page — use the raw file URL', { reason: 'html_page' }),
  tooLarge: (maxBytes: number) =>
    new ValidationError(`The file is larger than ${Math.floor(maxBytes / 1024)} KiB`, { reason: 'too_large' }),
  upstreamStatus: (status: number) =>
    new ExternalServiceError(`The URL answered HTTP ${status}`, { reason: 'upstream_status', status }),
  timeout: (ms: number) =>
    new ExternalServiceError(`The URL did not answer within ${Math.round(ms / 1000)} s`, { reason: 'timeout' }),
  unreachable: (code?: string) =>
    new ExternalServiceError('The URL could not be reached', { reason: 'unreachable', ...(code ? { code } : {}) }),
};

/** `text/html` or `application/xhtml+xml`, whatever the parameters. */
export function isHtmlContentType(contentType: string | null): boolean {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml';
}

// ---- fetcher --------------------------------------------------------------------

/** `https.request` in the one form the fetcher calls it with (tests pass a fake). */
export type HttpsRequest = (options: https.RequestOptions, callback: (res: IncomingMessage) => void) => ClientRequest;

export interface SafeFetchOptions {
  /** One budget for the whole redirect chain. */
  timeoutMs?: number;
  maxRedirects?: number;
  dnsLookup?: DnsLookup;
  request?: HttpsRequest;
  /** The `user-agent` the target sees (default `DevDigest-SkillImport/1.0`). */
  userAgent?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_USER_AGENT = 'DevDigest-SkillImport/1.0';

type Hop = { location: string } | { bytes: Uint8Array; contentType: string | null };

export class SafeHttpsFetcher implements UrlFetcher {
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly lookup: LookupFunction;
  private readonly request: HttpsRequest;
  private readonly headers: Record<string, string>;

  constructor(opts: SafeFetchOptions = {}) {
    this.headers = {
      accept: 'text/markdown, text/plain, application/zip, */*;q=0.5',
      'accept-encoding': 'identity',
      'user-agent': opts.userAgent ?? DEFAULT_USER_AGENT,
    };
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRedirects = opts.maxRedirects ?? 3;
    this.lookup = guardedLookup(opts.dnsLookup ?? dns.lookup);
    this.request = opts.request ?? https.request;
  }

  async fetch(url: URL, limits: { maxBytes: number }): Promise<FetchedFile> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let current = url;
    for (let redirects = 0; ; redirects++) {
      checkTarget(current, redirects > 0);
      const hop = await this.get(current, limits.maxBytes, signal);
      if (!('location' in hop)) return { ...hop, finalUrl: current };
      if (redirects >= this.maxRedirects) throw fetchErrors.tooManyRedirects(this.maxRedirects);
      try {
        current = new URL(hop.location, current);
      } catch {
        throw fetchErrors.insecureRedirect();
      }
    }
  }

  /** One request: a redirect's `Location`, or the whole (capped) body. */
  private get(url: URL, maxBytes: number, signal: AbortSignal): Promise<Hop> {
    return new Promise<Hop>((resolve, reject) => {
      let settled = false;
      let req: ClientRequest | undefined;
      const done = (hop: Hop) => {
        if (settled) return;
        settled = true;
        resolve(hop);
      };
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        req?.destroy();
        reject(this.toAppError(err, signal));
      };

      const onResponse = (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (REDIRECT_STATUSES.has(status) && location) {
          res.resume(); // drain; the next hop opens its own connection
          return done({ location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return fail(fetchErrors.upstreamStatus(status));
        }
        const contentType = res.headers['content-type'] ?? null;
        if (isHtmlContentType(contentType)) return fail(fetchErrors.htmlPage());
        if (Number(res.headers['content-length']) > maxBytes) return fail(fetchErrors.tooLarge(maxBytes));

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) return fail(fetchErrors.tooLarge(maxBytes));
          chunks.push(chunk);
        });
        res.on('end', () => done({ bytes: new Uint8Array(Buffer.concat(chunks)), contentType }));
        res.on('error', fail);
        // After 'end' this is a no-op; before it, the body was cut short.
        res.on('close', () => fail(new Error('The connection closed before the body ended')));
      };

      try {
        req = this.request(
          {
            protocol: 'https:',
            hostname: bareHost(url),
            port: 443,
            path: `${url.pathname}${url.search}`,
            method: 'GET',
            headers: this.headers,
            agent: false,
            lookup: this.lookup,
            signal,
          },
          onResponse,
        );
      } catch (err) {
        return fail(err);
      }
      req.on('error', fail);
      req.end();
    });
  }

  private toAppError(err: unknown, signal: AbortSignal): AppError {
    if (err instanceof AppError) return err;
    if (signal.aborted) return fetchErrors.timeout(this.timeoutMs);
    return fetchErrors.unreachable((err as NodeJS.ErrnoException | undefined)?.code);
  }
}

/** The host to connect to: an IPv6 literal without its brackets. */
function bareHost(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

/** Every hop: https, the default port, no credentials; an IP literal must be public. */
function checkTarget(url: URL, redirected: boolean): void {
  const secure = url.protocol === 'https:' && (url.port === '' || url.port === '443') && !url.username && !url.password;
  if (!secure) {
    if (redirected) throw fetchErrors.insecureRedirect();
    throw new ValidationError('Only https:// URLs on the default port, without credentials, can be fetched', {
      reason: 'invalid_url',
    });
  }
  const host = bareHost(url);
  if (isIP(host) !== 0 && !isPublicAddress(host)) throw fetchErrors.blockedAddress();
}
