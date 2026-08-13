// SSRF-guarded outbound fetch, shared by the api/* functions.
//
// Threat model: /api/read takes a URL from an untrusted caller. Without guards that
// is a server-side request forgery primitive — an attacker asks our function to fetch
// http://169.254.169.254/ (cloud metadata), http://127.0.0.1:8080/ (anything colocated),
// or a tailnet 100.64/10 address, and we hand back the response body.
//
// Defence in depth, in order of strength:
//   1. HOST ALLOWLIST (primary). Callers may only name hosts we explicitly serve.
//      This alone stops the whole class; everything below is backup.
//   2. https only. No http, no file:, no gopher:, no data:.
//   3. Every resolved address must be public. Blocks loopback, RFC1918, CGNAT/tailnet,
//      link-local (incl. the metadata endpoint), multicast, and the v6 equivalents.
//   4. Redirects followed MANUALLY, re-validating 1-3 on every hop. `redirect: 'follow'`
//      would let an allowlisted host bounce us anywhere.
//   5. Byte cap enforced while streaming, not from Content-Length (which upstream lies about).
//
// Known residual risk, stated rather than hidden: between the DNS check in step 3 and
// the socket the fetch actually opens, a hostile resolver could return a different
// address (DNS rebinding). Node's fetch gives no way to pin the resolved IP. Step 1 is
// what actually holds here — an attacker would have to control DNS for a host already
// on our allowlist, at which point they own that source anyway.
const dns = require('node:dns').promises;
const net = require('node:net');

class BlockedError extends Error {
  constructor(msg, status = 403) { super(msg); this.name = 'BlockedError'; this.status = status; }
}

function isPrivateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                              // 0.0.0.0/8 "this network"
  if (a === 10) return true;                             // RFC1918
  if (a === 127) return true;                            // loopback
  if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT 100.64/10 — tailnet lives here
  if (a === 169 && b === 254) return true;               // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;      // RFC1918
  if (a === 192 && b === 0) return true;                 // 192.0.0/24 IETF, 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 168) return true;               // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true;  // benchmarking
  if (a === 198 && b === 51) return true;                // TEST-NET-2
  if (a === 203 && b === 0) return true;                 // TEST-NET-3
  if (a >= 224) return true;                             // multicast, reserved, broadcast
  return false;
}

function isPrivateV6(ip) {
  const s = String(ip).toLowerCase().split('%')[0];      // drop any zone id
  if (s === '::' || s === '::1') return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || s.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);             // v4-mapped / v4-compatible
  const head = s.split(':')[0];
  if (/^f[cd]/.test(head)) return true;                  // fc00::/7 unique local
  if (/^fe[89ab]/.test(head)) return true;               // fe80::/10 link-local
  if (/^ff/.test(head)) return true;                     // ff00::/8 multicast
  return false;
}

function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;                                           // unparseable → refuse
}

// Throws BlockedError unless every address the hostname resolves to is public.
async function assertPublicHost(hostname, lookup = dns.lookup) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new BlockedError('address is not public');
    return;
  }
  let addrs;
  try { addrs = await lookup(hostname, { all: true, verbatim: true }); }
  catch { throw new BlockedError('host does not resolve'); }
  if (!Array.isArray(addrs) || addrs.length === 0) throw new BlockedError('host does not resolve');
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new BlockedError('host resolves to a non-public address');
  }
}

// Validate one URL: https, allowlisted host, no credentials, public addresses.
async function assertFetchable(url, allow, lookup) {
  if (url.protocol !== 'https:') throw new BlockedError('only https URLs are allowed');
  if (url.username || url.password) throw new BlockedError('credentials in URL are not allowed');
  if (!allow(url.hostname)) throw new BlockedError('host is not on the allowlist');
  await assertPublicHost(url.hostname, lookup);
}

// Read a response body with a hard byte cap, enforced as bytes arrive.
async function readCapped(res, maxBytes) {
  const declared = parseInt(res.headers.get('content-length') || '0', 10);
  if (declared && declared > maxBytes) throw new BlockedError('response too large', 413);
  if (!res.body) return '';
  const chunks = [];
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new BlockedError('response too large', 413);
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  return Buffer.concat(chunks.map(Buffer.from)).toString('utf8');
}

const DEFAULT_UA =
  'Mozilla/5.0 (compatible; Focal/2.0; +https://github.com/ryan-organically/RSVP)';

// Fetch a URL under all the guards above. Returns { res, finalUrl, hops }.
// `allow` is a predicate over hostname — callers pass their own allowlist.
async function safeFetch(rawUrl, opts = {}) {
  const {
    allow,
    timeoutMs = 15000,
    maxRedirects = 3,
    accept = 'text/html, text/plain, application/json, */*',
    ua = DEFAULT_UA,
    lookup,
  } = opts;
  if (typeof allow !== 'function') throw new Error('safeFetch requires an allow(hostname) predicate');

  let url;
  try { url = new URL(rawUrl); }
  catch { throw new BlockedError('malformed URL', 400); }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      await assertFetchable(url, allow, lookup);
      const res = await fetch(url.href, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': ua, Accept: accept },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= maxRedirects) throw new BlockedError('too many redirects');
        try { url = new URL(location, url); }
        catch { throw new BlockedError('malformed redirect target'); }
        continue;                                        // re-validate the new hop
      }
      return { res, finalUrl: url.href, hops: hop };
    }
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  BlockedError, safeFetch, readCapped, assertPublicHost, assertFetchable,
  isPrivateIp, isPrivateV4, isPrivateV6, DEFAULT_UA,
};
