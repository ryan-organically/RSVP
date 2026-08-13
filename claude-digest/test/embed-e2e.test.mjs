// End-to-end browser test of the embed handoff: embed.js on a host page -> the reader.
// Serves public/ itself and drives Chromium. Playwright is not a dependency of this
// repo, so this test SKIPS cleanly when it is not installed; `npm test` stays hermetic
// and this runs via `npm run test:e2e`.
//
// What it proves that the unit tests cannot: the button really appears on a foreign
// page, the extracted text really survives compression and the fragment, the reader
// really imports it, nothing is uploaded, and a malformed payload fails safely.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', '..', 'public');
const PORT = 3111;

// Playwright lives in sibling projects, not here. Try the local resolution first.
async function loadChromium() {
  const require = createRequire(import.meta.url);
  const candidates = [
    'playwright',
    '/home/ryan-organically/dev/malleable/node_modules/playwright/index.mjs',
  ];
  for (const c of candidates) {
    try {
      if (c.startsWith('/')) return (await import(c)).chromium;
      return require(c).chromium;
    } catch { /* try the next one */ }
  }
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  console.log('\nembed e2e: SKIPPED (playwright not installed)\n');
  process.exit(0);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.txt': 'text/plain',
                '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (!extname(p)) p += '.html';
  const file = join(PUBLIC, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const ck = (n, c, x) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', n, x === undefined ? '' : String(x).slice(0, 300)); }
};
const lib = page => page.evaluate(() =>
  JSON.parse(localStorage.getItem('rsvp:library') || '[]').map(b => ({ t: b.title, w: b.wordCount, s: b.source })));

const browser = await chromium.launch();

console.log('\nembed.js on a host page');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/embed.html', { waitUntil: 'networkidle' });

  const btn = page.locator('.focal-btn');
  ck('injects exactly one button', await btn.count() === 1, await btn.count());
  ck('honours the label option', (await btn.textContent()).includes('Read this in Focal'));

  const got = await page.evaluate(() => {
    const r = Focal.extract(document.querySelector('#sample'));
    return { title: r.title, words: r.text.split(/\s+/).length, head: r.text.slice(0, 30) };
  });
  ck('extract() pulls the prose, not the chrome',
     got.words > 150 && got.head.startsWith('On reading faster'), JSON.stringify(got));
  ck('extract() finds a title', got.title.length > 0, got.title);
  ck('no cookies set on the host page', (await ctx.cookies()).length === 0);

  // The reader scrubs its own URL on boot, so record what window.open was called with.
  await page.evaluate(() => {
    const o = window.open.bind(window); window.__opened = [];
    window.open = (u, ...r) => { window.__opened.push(String(u)); return o(u, ...r); };
  });
  const [reader] = await Promise.all([ctx.waitForEvent('page'), btn.click()]);
  const opened = (await page.evaluate(() => window.__opened[0])) || '';
  ck('opens the reader with a compressed fragment', /#t=[A-Za-z0-9_-]{100,}/.test(opened), opened.slice(0, 90));
  ck('fragment carries the title', /[#&]ti=/.test(opened));
  ck('no query string, so the text cannot reach a server', new URL(opened).search === '');

  const rerrs = []; reader.on('pageerror', e => rerrs.push(e.message));
  await reader.waitForLoadState('domcontentloaded');
  await reader.waitForTimeout(3500);
  const state = await reader.evaluate(() => ({
    hash: location.hash, word: document.getElementById('wordDisplay')?.textContent?.trim() || '',
  }));
  const books = await lib(reader);
  ck('reader scrubs the fragment out of the address bar', state.hash === '', state.hash);
  ck('text landed in the local library with a word count',
     books.length === 1 && books[0].w > 150, JSON.stringify(books));
  ck('tagged as an embed import', books[0]?.s === 'embed', JSON.stringify(books));
  ck('reader is rendering a word', state.word.length > 0, JSON.stringify(state));
  ck('no page errors in the reader', rerrs.length === 0, rerrs.join(' | '));
  ck('no page errors on the host page', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\nlong-text handoff (postMessage path)');
{
  const ctx = await browser.newContext();
  const opener = await ctx.newPage();
  await opener.goto(BASE + '/embed.html');
  const big = 'The quick brown fox jumped over the lazy dog and kept running. '.repeat(400);
  const [reader] = await Promise.all([
    ctx.waitForEvent('page'),
    opener.evaluate((text) => {
      const w = window.open(location.origin + '/#post=1&ti=Posted%20Chapter', '_blank');
      window.addEventListener('message', ev => {
        if (ev.data && ev.data.focal === 'ready') {
          w.postMessage({ focal: 'text', text, title: 'Posted Chapter' }, location.origin);
        }
      });
    }, big),
  ]);
  const errs = []; reader.on('pageerror', e => errs.push(e.message));
  await reader.waitForLoadState('domcontentloaded');
  await reader.waitForTimeout(3500);
  const books = await lib(reader);
  const state = await reader.evaluate(() => ({
    hash: location.hash, word: document.getElementById('wordDisplay')?.textContent?.trim() || '' }));
  ck('reader accepts text posted by its opener', books.some(b => b.t === 'Posted Chapter'), JSON.stringify(books));
  ck('full text arrives intact', books.find(b => b.t === 'Posted Chapter')?.w > 4000, JSON.stringify(books));
  ck('fragment scrubbed here too', state.hash === '', state.hash);
  ck('reader is rendering a word', state.word.length > 0, JSON.stringify(state));
  ck('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\nMCP link opens in the real reader');
{
  // The MCP server builds the same fragment the embed does. Prove a link produced by
  // focal_open actually reads, rather than just looking well-formed.
  const { focalUrl } = await import(join(__dirname, '..', '..', 'mcp', 'index.js'));
  const agentOutput = 'Findings from the audit.\n\n' +
    'The first issue is that the cache key omitted the tenant id. '.repeat(40);
  const url = focalUrl(agentOutput, { title: 'Agent Findings', wpm: 450 })
    .replace('https://focal.wiki', BASE);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(3500);
  const books = await lib(page);
  const state = await page.evaluate(() => ({
    hash: location.hash, word: document.getElementById('wordDisplay')?.textContent?.trim() || '',
    wpm: document.getElementById('wpmLabel')?.textContent || '',
  }));
  ck('an MCP focal_open link imports under its title',
     books.length === 1 && books[0].t === 'Agent Findings', JSON.stringify(books));
  ck('the whole agent output arrives', books[0]?.w > 400, JSON.stringify(books));
  ck('the wpm from the link is applied', state.wpm === '450', state.wpm);
  ck('reader is rendering a word', state.word.length > 0, JSON.stringify(state));
  ck('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\nmalformed payloads fail safely');
{
  const ctx = await browser.newContext();          // fresh profile: empty library
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/#t=!!!not-valid-base64!!!');
  await page.waitForTimeout(2500);
  ck('no uncaught error', errs.length === 0, errs.join(' | '));
  ck('nothing is imported', (await lib(page)).length === 0, JSON.stringify(await lib(page)));
  ck('the reader says so', /Could not open that text/.test(
     await page.evaluate(() => document.querySelector('.toast')?.textContent || '')));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
