// Tests api/read.js, lib/fetch-safe.js and lib/extract.js with no network.
// globalThis.fetch and dns.promises.lookup are both stubbed; a test that reaches the
// real internet is a test that fails in CI, and an SSRF guard that is only exercised
// against the real internet is a guard nobody has actually checked.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import nodeDns from 'node:dns';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(__dirname, '..', '..');

const safe = require(join(ROOT, 'lib', 'fetch-safe.js'));
const { extract, tagsToText, decodeEntities } = require(join(ROOT, 'lib', 'extract.js'));
const handler = require(join(ROOT, 'api', 'read.js'));

let pass = 0, fail = 0;
const ck = (n, c, x) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', n, x === undefined ? '' : JSON.stringify(x)); }
};

// ---- stubs ----------------------------------------------------------------
// Every hostname resolves to one public address unless a test says otherwise.
let dnsMap = {};
nodeDns.promises.lookup = async (host) => {
  if (dnsMap[host] === null) throw new Error('ENOTFOUND');
  return [{ address: dnsMap[host] || '93.184.216.34', family: 4 }];
};

let routes = {};          // exact url -> {status, body, headers}
let requested = [];
globalThis.fetch = async (url) => {
  requested.push(String(url));
  const r = routes[String(url)];
  if (!r) return new Response('not found', { status: 404 });
  return new Response(r.body === undefined ? '' : r.body, {
    status: r.status || 200,
    headers: r.headers || {},
  });
};

function mkRes() {
  const res = { _b: null, _h: {}, statusCode: 0 };
  res.setHeader = (k, v) => { res._h[k] = v; };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res._b = b; return res; };
  res.send = b => { res._b = b; return res; };
  res.end = () => res;
  return res;
}
async function call(query) {
  const res = mkRes();
  await handler({ method: 'GET', headers: {}, query, url: '/api/read' }, res);
  return res;
}

console.log('\nlib/fetch-safe — private address detection');
{
  const priv = ['127.0.0.1', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1',
                '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0',
                '224.0.0.1', '255.255.255.255', '198.18.0.1', '203.0.113.9'];
  const pub = ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1',
               '100.63.255.255', '100.128.0.1', '192.169.0.1'];
  ck('blocks every private/reserved v4 range', priv.every(safe.isPrivateV4),
     priv.filter(i => !safe.isPrivateV4(i)));
  ck('allows public v4', pub.every(i => !safe.isPrivateV4(i)),
     pub.filter(safe.isPrivateV4));
  ck('CGNAT/tailnet 100.64/10 is blocked but 100.63 and 100.128 are not',
     safe.isPrivateV4('100.100.1.1') && !safe.isPrivateV4('100.63.0.1') && !safe.isPrivateV4('100.128.0.1'));

  const priv6 = ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
                 '::ffff:127.0.0.1', '::ffff:169.254.169.254'];
  const pub6 = ['2606:4700:4700::1111', '2001:4860:4860::8888'];
  ck('blocks private/reserved v6', priv6.every(safe.isPrivateV6), priv6.filter(i => !safe.isPrivateV6(i)));
  ck('allows public v6', pub6.every(i => !safe.isPrivateV6(i)), pub6.filter(safe.isPrivateV6));
  ck('unparseable input is refused, not allowed', safe.isPrivateIp('not-an-ip') === true);
  ck('link-local zone id does not bypass the check', safe.isPrivateV6('fe80::1%eth0') === true);
}

console.log('\nlib/fetch-safe — safeFetch guards');
{
  const allowAll = () => true;
  const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

  ck('http is refused', (await err(() => safe.safeFetch('http://example.com/', { allow: allowAll })))
     ?.includes('https'));
  ck('non-allowlisted host is refused',
     (await err(() => safe.safeFetch('https://evil.test/', { allow: h => h === 'good.test' })))
       ?.includes('allowlist'));
  ck('credentials in the URL are refused',
     (await err(() => safe.safeFetch('https://u:p@example.com/', { allow: allowAll })))
       ?.includes('credentials'));

  dnsMap = { 'rebind.test': '127.0.0.1' };
  ck('allowlisted host resolving to loopback is refused',
     (await err(() => safe.safeFetch('https://rebind.test/', { allow: allowAll })))
       ?.includes('non-public'));
  dnsMap = { 'meta.test': '169.254.169.254' };
  ck('allowlisted host resolving to the metadata IP is refused',
     (await err(() => safe.safeFetch('https://meta.test/', { allow: allowAll })))
       ?.includes('non-public'));
  dnsMap = { 'nx.test': null };
  ck('unresolvable host is refused', (await err(() => safe.safeFetch('https://nx.test/', { allow: allowAll })))
     ?.includes('resolve'));
  dnsMap = {};

  // The one that matters: an allowlisted host redirecting off the allowlist.
  routes = {
    'https://good.test/a': { status: 302, headers: { location: 'https://evil.test/steal' } },
    'https://evil.test/steal': { status: 200, body: 'secrets' },
  };
  requested = [];
  const msg = await err(() => safe.safeFetch('https://good.test/a', { allow: h => h === 'good.test' }));
  ck('redirect off the allowlist is refused', msg?.includes('allowlist'), msg);
  ck('and the off-allowlist URL was never fetched', !requested.includes('https://evil.test/steal'), requested);

  routes = {
    'https://good.test/a': { status: 302, headers: { location: 'http://good.test/b' } },
  };
  ck('redirect that downgrades to http is refused',
     (await err(() => safe.safeFetch('https://good.test/a', { allow: h => h === 'good.test' })))
       ?.includes('https'));

  routes = {
    'https://good.test/1': { status: 302, headers: { location: 'https://good.test/2' } },
    'https://good.test/2': { status: 302, headers: { location: 'https://good.test/3' } },
    'https://good.test/3': { status: 302, headers: { location: 'https://good.test/4' } },
    'https://good.test/4': { status: 302, headers: { location: 'https://good.test/5' } },
  };
  ck('redirect chains are bounded',
     (await err(() => safe.safeFetch('https://good.test/1', { allow: h => h === 'good.test' })))
       ?.includes('redirects'));

  routes = { 'https://good.test/ok': { status: 200, body: 'hello' } };
  const { res, hops } = await safe.safeFetch('https://good.test/ok', { allow: h => h === 'good.test' });
  ck('a clean fetch succeeds', res.status === 200 && hops === 0);
  ck('readCapped returns the body', (await safe.readCapped(res, 1000)) === 'hello');

  routes = { 'https://good.test/big': { status: 200, body: 'x'.repeat(5000) } };
  const big = (await safe.safeFetch('https://good.test/big', { allow: h => h === 'good.test' })).res;
  let capped = null;
  try { await safe.readCapped(big, 100); } catch (e) { capped = e; }
  ck('readCapped enforces the byte cap while streaming', capped && capped.status === 413);

  routes = { 'https://good.test/liar': { status: 200, body: 'small', headers: { 'content-length': '999999999' } } };
  const liar = (await safe.safeFetch('https://good.test/liar', { allow: h => h === 'good.test' })).res;
  let declared = null;
  try { await safe.readCapped(liar, 1000); } catch (e) { declared = e; }
  ck('an oversized Content-Length is rejected up front', declared && declared.status === 413);
}

console.log('\nlib/extract');
{
  const html = `<!doctype html><html><head><title>The Real Title</title>
    <meta name="author" content="A. Writer">
    <style>.x{color:red}</style><script>alert(1)</script></head>
    <body><nav><a href="/">Home</a><a href="/x">Nav link</a></nav>
    <header>Site name</header>
    <div id="wrap"><article>
      <h1>The Real Title</h1>
      <p>First paragraph with enough words in it to clear the length threshold comfortably.</p>
      <p>Second paragraph, also long enough to count toward the prose score for this block.</p>
    </article></div>
    <aside><p>Related stories you might also like reading right now, promoted content.</p></aside>
    <footer>Copyright &copy; 2026</footer></body></html>`;
  const got = extract(html);
  ck('title comes from <title>', got.title === 'The Real Title', got.title);
  ck('byline comes from meta[name=author]', got.byline === 'A. Writer', got.byline);
  ck('script and style content is dropped', !/alert\(1\)|color:red/.test(got.text), got.text);
  ck('nav/header/footer/aside are dropped',
     !/Home|Site name|Copyright|Related stories/.test(got.text), got.text);
  ck('both article paragraphs survive',
     got.text.includes('First paragraph') && got.text.includes('Second paragraph'), got.text);
  ck('the duplicated h1 title is not repeated at the top', !got.text.startsWith('The Real Title'), got.text.slice(0, 40));
  ck('word count is counted', got.words > 20, got.words);

  ck('entities decode', decodeEntities('caf&eacute; &amp; &#8212; &#x2014; &quot;q&quot;')
     === 'café & — — "q"');
  ck('unknown entities are left alone', decodeEntities('&bogus; x') === '&bogus; x');
  ck('block tags become paragraph breaks',
     tagsToText('<p>one</p><p>two</p>') === 'one\n\ntwo');
  ck('<br> becomes a single newline', tagsToText('a<br>b') === 'a\nb');
  ck('a link-heavy block scores below real prose', (() => {
    const linkFarm = `<html><body><div><p>${'<a href="/x">link text here</a> '.repeat(40)}</p></div>
      <article><p>Genuine article prose that runs on for a while and reads like a real sentence.</p>
      <p>A second genuine sentence, also long enough to be counted by the paragraph scorer.</p></article></body></html>`;
    return extract(linkFarm).text.includes('Genuine article prose');
  })());
}

console.log('\napi/read — request handling');
{
  dnsMap = {}; routes = {};
  ck('missing url → 400', (await call({})).statusCode === 400);
  ck('malformed url → 400', (await call({ url: 'not a url' })).statusCode === 400);

  let r = await call({ url: 'https://evil.example.com/x' });
  ck('non-allowlisted host → 403', r.statusCode === 403 && /allowlist/.test(r._b.error), r._b);
  ck('403 tells the caller what IS allowed', Array.isArray(r._b.allowed) && r._b.allowed.includes('*.wikipedia.org'));

  ck('http url → 403 before any fetch', (await call({ url: 'http://gutenberg.org/x.txt' })).statusCode === 403);
  ck('file: url → 400/403, never fetched', [400, 403].includes((await call({ url: 'file:///etc/passwd' })).statusCode));

  ck('classify routes by host',
     handler.classify(new URL('https://en.wikipedia.org/wiki/X')) === 'wikipedia' &&
     handler.classify(new URL('https://arxiv.org/abs/2405.01234')) === 'arxiv' &&
     handler.classify(new URL('https://www.gutenberg.org/files/1/1.txt')) === 'gutenberg');
  ck('arxiv ids parse from abs/pdf/html and versioned forms',
     handler.arxivId(new URL('https://arxiv.org/abs/2405.01234')) === '2405.01234' &&
     handler.arxivId(new URL('https://arxiv.org/abs/2405.01234v3')) === '2405.01234' &&
     handler.arxivId(new URL('https://arxiv.org/pdf/2405.01234v2.pdf')) === '2405.01234' &&
     handler.arxivId(new URL('https://arxiv.org/abs/math/0309285')) === 'math/0309285');
  ck('mobile and non-en wikipedia hosts are allowed',
     handler.hostAllowed('en.m.wikipedia.org') && handler.hostAllowed('de.wikipedia.org') &&
     handler.hostAllowed('simple.wikipedia.org'));
  ck('a lookalike wikipedia host is NOT allowed',
     !handler.hostAllowed('wikipedia.org.evil.com') && !handler.hostAllowed('evilwikipedia.org'));
}

console.log('\napi/read — Wikipedia');
{
  const api = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2' +
    '&prop=extracts&explaintext=1&redirects=1&titles=Rapid_serial_visual_presentation';
  routes = { [api]: { status: 200, body: JSON.stringify({
    query: { pages: [{ title: 'Rapid serial visual presentation', extract: 'RSVP is a method of displaying text one word at a time.' }] },
  }) } };
  let r = await call({ url: 'https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation' });
  ck('happy path → 200 with text', r.statusCode === 200 && r._b.text.startsWith('RSVP is a method'), r._b);
  ck('reports source, title, canonical, word count',
     r._b.source === 'wikipedia' && r._b.title === 'Rapid serial visual presentation' &&
     r._b.url === 'https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation' && r._b.words === 12, r._b);
  ck('public documents are cached at the edge', /s-maxage=\d+/.test(r._h['Cache-Control']));
  ck('CORS is open (public data only)', r._h['Access-Control-Allow-Origin'] === '*');

  r = await call({ url: 'https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation', format: 'text' });
  ck('format=text returns text/plain', r._h['Content-Type'] === 'text/plain; charset=utf-8' &&
     r._b.startsWith('RSVP is a method'));

  routes = { [api.replace('Rapid_serial_visual_presentation', 'Nope')]: { status: 200,
    body: JSON.stringify({ query: { pages: [{ title: 'Nope', missing: true }] } }) } };
  ck('missing article → 404', (await call({ url: 'https://en.wikipedia.org/wiki/Nope' })).statusCode === 404);
}

console.log('\napi/read — arXiv');
{
  routes = {
    'https://arxiv.org/html/2405.01234': { status: 200, body:
      `<html><head><title>A Paper - arXiv</title></head><body><article>` +
      `<p>${'This is the body of a paper with plenty of words in it. '.repeat(60)}</p>` +
      `</article></body></html>` },
  };
  let r = await call({ url: 'https://arxiv.org/abs/2405.01234' });
  ck('HTML rendering is preferred when it exists', r.statusCode === 200 && r._b.words > 500, r._b?.words);
  ck('the " - arXiv" title suffix is trimmed', r._b.title === 'A Paper', r._b?.title);
  ck('canonical points back at /abs/', r._b.url === 'https://arxiv.org/abs/2405.01234');

  // No HTML rendering → Atom API fallback.
  routes = {
    'https://export.arxiv.org/api/query?id_list=2405.09999&max_results=1': { status: 200, body:
      `<feed><entry><title>Fallback Paper</title><published>2024-05-02T00:00:00Z</published>
       <summary>An abstract that stands in for the full text.</summary>
       <author><name>R. Scanlon</name></author><author><name>B. Coauthor</name></author>
       </entry></feed>` },
  };
  r = await call({ url: 'https://arxiv.org/abs/2405.09999' });
  ck('falls back to the Atom API → 200', r.statusCode === 200, r._b);
  ck('fallback carries title, authors and abstract',
     r._b.title === 'Fallback Paper' && r._b.byline === 'R. Scanlon, B. Coauthor' &&
     r._b.text.includes('An abstract that stands in'), r._b);

  routes = {};
  ck('unknown arXiv id → 404', (await call({ url: 'https://arxiv.org/abs/9999.99999' })).statusCode === 404);
  ck('non-paper arXiv URL → 400', (await call({ url: 'https://arxiv.org/list/cs.AI/recent' })).statusCode === 400);
}

console.log('\napi/read — Gutenberg plain text');
{
  routes = { 'https://www.gutenberg.org/files/2701/2701-0.txt': { status: 200, body:
    'Title: Moby Dick\nAuthor: Herman Melville\n\nCall me Ishmael. Some years ago, never mind how long precisely.' } };
  const r = await call({ url: 'https://www.gutenberg.org/files/2701/2701-0.txt' });
  ck('plain text passes through with Title/Author parsed',
     r.statusCode === 200 && r._b.title === 'Moby Dick' && r._b.byline === 'Herman Melville' &&
     r._b.text.includes('Call me Ishmael'), r._b);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
