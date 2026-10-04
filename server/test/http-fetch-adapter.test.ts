import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { isIP } from 'node:net';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import {
  SafeHttpsFetcher,
  guardedLookup,
  isPublicAddress,
  type DnsLookup,
  type HttpsRequest,
  type LookupFunction,
} from '../src/adapters/http/safe-fetch.js';

/**
 * The skill-import fetcher's SSRF guard, with no network: `dnsLookup` and
 * `request` are injected. The fake request resolves its host through the
 * `lookup` it is given, the way Node 22 does (`all: true`, skipped for an IP
 * literal), then answers from a table keyed by href.
 */

// ---- fakes ----------------------------------------------------------------------

/** DNS: hostname → addresses; an unknown host is ENOTFOUND. Records the options it was asked with. */
function fakeDns(table: Record<string, string[]>) {
  const asked: LookupAllOptions[] = [];
  const lookup: DnsLookup = (hostname, options, callback) => {
    asked.push(options);
    const list = table[hostname];
    setImmediate(() => {
      if (!list) return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), []);
      callback(
        null,
        list.map((address) => ({ address, family: isIP(address) })),
      );
    });
  };
  return { lookup, asked };
}

type Reply = { status?: number; headers?: Record<string, string>; chunks?: (string | Buffer)[]; hang?: boolean };

class FakeRequest extends EventEmitter {
  destroyed = false;
  res?: PassThrough;
  start: () => void = () => {};
  end() {
    setImmediate(() => this.start());
    return this;
  }
  destroy(err?: Error) {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.res?.destroy();
    if (err) setImmediate(() => this.emit('error', err));
    return this;
  }
}

function fakeHttps(replies: Record<string, Reply>) {
  const sent: { href: string; options: RequestOptions; req: FakeRequest }[] = [];
  const request: HttpsRequest = (options, onResponse) => {
    const req = new FakeRequest();
    const href = `https://${options.hostname}${options.path}`;
    sent.push({ href, options, req });
    const respond = (): void => {
      const reply = replies[href];
      if (!reply) {
        req.destroy(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
        return;
      }
      if (reply.hang) return;
      const res = new PassThrough();
      Object.assign(res, { statusCode: reply.status ?? 200, headers: reply.headers ?? {} });
      req.res = res;
      onResponse(res as unknown as IncomingMessage);
      for (const chunk of reply.chunks ?? []) if (!res.destroyed) res.write(chunk);
      if (!res.destroyed) res.end();
    };
    req.start = () => {
      const host = String(options.hostname);
      if (isIP(host)) return respond(); // Node never calls lookup for a literal
      (options.lookup as LookupFunction)(host, { all: true }, (err) => {
        if (err) req.destroy(err);
        else respond();
      });
    };
    options.signal?.addEventListener('abort', () =>
      req.destroy(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })),
    );
    return req as unknown as ClientRequest;
  };
  return { request, sent };
}

const PUBLIC_DNS = {
  'raw.example': ['93.184.216.34'],
  'cdn.example': ['151.101.0.1', '2a04:4e42::1'],
  'internal.example': ['10.0.0.5'],
  'rebind.example': ['93.184.216.34', '127.0.0.1'],
};

function fetcherFor(replies: Record<string, Reply>, opts: { timeoutMs?: number } = {}) {
  const https = fakeHttps(replies);
  const fetcher = new SafeHttpsFetcher({ dnsLookup: fakeDns(PUBLIC_DNS).lookup, request: https.request, ...opts });
  return { fetcher, sent: https.sent };
}

/** The AppError a fetch rejects with, as `{status, reason}`. */
async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    const e = err as { statusCode: number; details: { reason: string; status?: number } };
    return { status: e.statusCode, reason: e.details.reason, upstream: e.details.status };
  }
  throw new Error('expected the fetch to fail');
}

const MAX = { maxBytes: 1000 };
const ok = (body: string, headers: Record<string, string> = { 'content-type': 'text/markdown' }): Reply => ({
  status: 200,
  headers,
  chunks: [body],
});

// ---- addresses ------------------------------------------------------------------

describe('isPublicAddress', () => {
  it.each([
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.0.9', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.19.255.255',
    '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  ])('blocks IPv4 %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '198.17.255.255', '198.20.0.0', '192.0.1.1'])(
    'allows IPv4 %s',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    '::', '::1', '[::1]', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '2001:db8::1',
    '100::1', '::127.0.0.1',
    // IPv4-mapped and NAT64: judged by the IPv4 address inside
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:10.0.0.1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:c0a8:0101',
    '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b::a9fe:a9fe',
  ])('blocks IPv6 %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '64:ff9b::808:808'])(
    'allows IPv6 %s',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each(['localhost', 'example.com', '', '1.2.3', '999.1.1.1', '::ffff:999.0.0.1'])('a non-address %j is not public', (x) =>
    expect(isPublicAddress(x)).toBe(false),
  );
});

describe('guardedLookup', () => {
  const lookupAll = (lookup: LookupFunction, host: string) =>
    new Promise<{ err: Error | null; address: string | LookupAddress[] }>((resolve) =>
      lookup(host, { all: true }, (err, address) => resolve({ err, address })),
    );
  const lookupOne = (lookup: LookupFunction, host: string) =>
    new Promise<{ err: Error | null; address: string | LookupAddress[]; family: number | undefined }>((resolve) =>
      lookup(host, { family: 0 }, (err, address, family) => resolve({ err, address, family })),
    );

  it('always resolves every address, and answers in the form Node asked for', async () => {
    const dns = fakeDns(PUBLIC_DNS);
    const lookup = guardedLookup(dns.lookup);
    expect(await lookupAll(lookup, 'cdn.example')).toEqual({
      err: null,
      address: [
        { address: '151.101.0.1', family: 4 },
        { address: '2a04:4e42::1', family: 6 },
      ],
    });
    expect(await lookupOne(lookup, 'cdn.example')).toEqual({ err: null, address: '151.101.0.1', family: 4 });
    expect(dns.asked.every((o) => o.all === true)).toBe(true);
    expect(dns.asked[1]).toMatchObject({ family: 0, all: true });
  });

  it('refuses a private answer, and a public + private mix (rebinding), in both forms', async () => {
    const lookup = guardedLookup(fakeDns(PUBLIC_DNS).lookup);
    for (const host of ['internal.example', 'rebind.example']) {
      expect((await lookupAll(lookup, host)).err).toMatchObject({ statusCode: 422, details: { reason: 'blocked_address' } });
      expect(await lookupOne(lookup, host)).toMatchObject({ err: { details: { reason: 'blocked_address' } }, address: '' });
    }
  });

  it('refuses an empty answer and passes a resolver error through', async () => {
    const lookup = guardedLookup(fakeDns({ 'empty.example': [] }).lookup);
    expect((await lookupOne(lookup, 'empty.example')).err).toMatchObject({ details: { reason: 'blocked_address' } });
    expect((await lookupAll(lookup, 'nowhere.example')).err).toMatchObject({ code: 'ENOTFOUND' });
  });
});

// ---- fetching -------------------------------------------------------------------

describe('SafeHttpsFetcher', () => {
  it('fetches a file with a plain, uncompressed, agent-less request through the guarded lookup', async () => {
    const { fetcher, sent } = fetcherFor({ 'https://raw.example/a/SKILL.md?ref=main': ok('# Skill\nBody.') });
    const file = await fetcher.fetch(new URL('https://raw.example/a/SKILL.md?ref=main#frag'), MAX);
    expect(new TextDecoder().decode(file.bytes)).toBe('# Skill\nBody.');
    expect(file.contentType).toBe('text/markdown');
    expect(file.finalUrl.href).toBe('https://raw.example/a/SKILL.md?ref=main#frag');
    const { options } = sent[0]!;
    expect(options).toMatchObject({ method: 'GET', port: 443, agent: false, path: '/a/SKILL.md?ref=main' });
    expect(options.headers).toMatchObject({
      'accept-encoding': 'identity',
      'user-agent': 'DevDigest-SkillImport/1.0',
      accept: 'text/markdown, text/plain, application/zip, */*;q=0.5',
    });
    expect(typeof options.lookup).toBe('function');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    'https://127.0.0.1/x.md',
    'https://[::1]/x.md',
    'https://[::ffff:7f00:1]/x.md',
    'https://169.254.169.254/latest/meta-data',
    'https://2130706433/x.md', // WHATWG URL reads this as 127.0.0.1
    'https://0x7f.1/x.md',
  ])('refuses the IP literal %s before any request', async (raw) => {
    const { fetcher, sent } = fetcherFor({});
    expect(await failure(fetcher.fetch(new URL(raw), MAX))).toMatchObject({ status: 422, reason: 'blocked_address' });
    expect(sent).toEqual([]);
  });

  it('refuses a host that resolves to a private address, or to a mix (422 blocked_address)', async () => {
    const { fetcher, sent } = fetcherFor({
      'https://internal.example/x.md': ok('secret'),
      'https://rebind.example/x.md': ok('secret'),
    });
    for (const host of ['internal.example', 'rebind.example']) {
      expect(await failure(fetcher.fetch(new URL(`https://${host}/x.md`), MAX))).toMatchObject({
        status: 422,
        reason: 'blocked_address',
      });
    }
    expect(sent.every((s) => s.req.res === undefined)).toBe(true); // never connected
  });

  it('refuses a non-https, non-default-port or credentialed URL (defense in depth)', async () => {
    const { fetcher, sent } = fetcherFor({});
    for (const raw of ['http://raw.example/x.md', 'https://raw.example:8443/x.md', 'https://u:p@raw.example/x.md']) {
      expect(await failure(fetcher.fetch(new URL(raw), MAX))).toMatchObject({ status: 422, reason: 'invalid_url' });
    }
    expect(sent).toEqual([]);
  });

  it('follows up to 3 redirects, re-resolving each hop, and returns the final URL', async () => {
    const { fetcher, sent } = fetcherFor({
      'https://raw.example/1': { status: 301, headers: { location: '/2' } },
      'https://raw.example/2': { status: 302, headers: { location: 'https://cdn.example/3' } },
      'https://cdn.example/3': { status: 307, headers: { location: '4.md' } },
      'https://cdn.example/4.md': ok('# Done'),
    });
    const file = await fetcher.fetch(new URL('https://raw.example/1'), MAX);
    expect(file.finalUrl.href).toBe('https://cdn.example/4.md');
    expect(sent.map((s) => s.href)).toEqual([
      'https://raw.example/1',
      'https://raw.example/2',
      'https://cdn.example/3',
      'https://cdn.example/4.md',
    ]);
  });

  it('a 4th redirect is 422 too_many_redirects', async () => {
    const { fetcher, sent } = fetcherFor({
      'https://raw.example/1': { status: 301, headers: { location: '/2' } },
      'https://raw.example/2': { status: 302, headers: { location: '/3' } },
      'https://raw.example/3': { status: 303, headers: { location: '/4' } },
      'https://raw.example/4': { status: 308, headers: { location: '/5' } },
      'https://raw.example/5': ok('never fetched'),
    });
    expect(await failure(fetcher.fetch(new URL('https://raw.example/1'), MAX))).toMatchObject({
      status: 422,
      reason: 'too_many_redirects',
    });
    expect(sent).toHaveLength(4);
  });

  it('a redirect to http:, another port or a private literal is refused before it is followed', async () => {
    const { fetcher, sent } = fetcherFor({
      'https://raw.example/down': { status: 302, headers: { location: 'http://raw.example/x.md' } },
      'https://raw.example/port': { status: 302, headers: { location: 'https://raw.example:8080/x.md' } },
      'https://raw.example/creds': { status: 302, headers: { location: 'https://a:b@raw.example/x.md' } },
      'https://raw.example/meta': { status: 302, headers: { location: 'https://169.254.169.254/latest' } },
      'https://raw.example/inside': { status: 302, headers: { location: 'https://internal.example/x.md' } },
    });
    const reason = async (path: string) => (await failure(fetcher.fetch(new URL(`https://raw.example${path}`), MAX))).reason;
    expect(await reason('/down')).toBe('insecure_redirect');
    expect(await reason('/port')).toBe('insecure_redirect');
    expect(await reason('/creds')).toBe('insecure_redirect');
    expect(await reason('/meta')).toBe('blocked_address');
    expect(await reason('/inside')).toBe('blocked_address'); // resolved at connect time
    expect(sent.map((s) => s.href)).toEqual([
      'https://raw.example/down',
      'https://raw.example/port',
      'https://raw.example/creds',
      'https://raw.example/meta',
      'https://raw.example/inside',
      'https://internal.example/x.md',
    ]);
  });

  it('refuses an HTML page (422 html_page) and tells the user to use the raw URL', async () => {
    const { fetcher } = fetcherFor({
      'https://raw.example/blob.md': ok('<html>', { 'content-type': 'text/html; charset=utf-8' }),
      'https://raw.example/x.xhtml': ok('<html>', { 'content-type': 'Application/XHTML+XML' }),
    });
    const err = fetcher.fetch(new URL('https://raw.example/blob.md'), MAX);
    await expect(err).rejects.toThrow('The URL returned a web page — use the raw file URL');
    expect(await failure(fetcher.fetch(new URL('https://raw.example/x.xhtml'), MAX))).toMatchObject({ reason: 'html_page' });
  });

  it('refuses a declared content-length over the cap without reading, and destroys the request', async () => {
    const { fetcher, sent } = fetcherFor({
      'https://raw.example/big.md': { status: 200, headers: { 'content-length': '5000' }, chunks: ['x'.repeat(5000)] },
    });
    expect(await failure(fetcher.fetch(new URL('https://raw.example/big.md'), MAX))).toMatchObject({
      status: 422,
      reason: 'too_large',
    });
    expect(sent[0]!.req.destroyed).toBe(true);
  });

  it('stops a streamed body at the cap when no length is declared, and destroys the request', async () => {
    const { fetcher, sent } = fetcherFor({
      'https://raw.example/stream.md': { status: 200, chunks: ['a'.repeat(600), 'b'.repeat(600), 'c'.repeat(600)] },
      'https://raw.example/exact.md': { status: 200, chunks: ['a'.repeat(500), 'b'.repeat(500)] },
    });
    expect(await failure(fetcher.fetch(new URL('https://raw.example/stream.md'), MAX))).toMatchObject({
      status: 422,
      reason: 'too_large',
    });
    expect(sent[0]!.req.destroyed).toBe(true);
    expect((await fetcher.fetch(new URL('https://raw.example/exact.md'), MAX)).bytes.length).toBe(1000);
  });

  it('a non-2xx answer is 502 upstream_status with the status', async () => {
    const { fetcher } = fetcherFor({
      'https://raw.example/missing.md': { status: 404, chunks: ['Not Found'] },
      'https://raw.example/broken.md': { status: 500 },
      'https://raw.example/noloc.md': { status: 302 }, // a redirect without Location
    });
    expect(await failure(fetcher.fetch(new URL('https://raw.example/missing.md'), MAX))).toEqual({
      status: 502,
      reason: 'upstream_status',
      upstream: 404,
    });
    expect((await failure(fetcher.fetch(new URL('https://raw.example/broken.md'), MAX))).upstream).toBe(500);
    expect((await failure(fetcher.fetch(new URL('https://raw.example/noloc.md'), MAX))).upstream).toBe(302);
  });

  it('a timeout is 502 timeout; an unknown host or a refused connection is 502 unreachable', async () => {
    const slow = fetcherFor({ 'https://raw.example/slow.md': { hang: true } }, { timeoutMs: 30 });
    expect(await failure(slow.fetcher.fetch(new URL('https://raw.example/slow.md'), MAX))).toMatchObject({
      status: 502,
      reason: 'timeout',
    });
    expect(slow.sent[0]!.req.destroyed).toBe(true);

    const { fetcher } = fetcherFor({});
    expect(await failure(fetcher.fetch(new URL('https://nowhere.example/x.md'), MAX))).toMatchObject({
      status: 502,
      reason: 'unreachable',
    });
    expect(await failure(fetcher.fetch(new URL('https://raw.example/refused.md'), MAX))).toMatchObject({
      status: 502,
      reason: 'unreachable',
    });
  });
});
