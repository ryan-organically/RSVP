// Dependency-free HTML -> readable text. Shared by /api/read and (later) embed.js.
//
// This is a Readability-shaped heuristic, not a port: strip the furniture, pick the
// densest prose container, flatten it to paragraphs. It is deliberately small and
// deterministic — no DOM, no npm tree — because it runs both in a serverless function
// and, in a trimmed form, inside a page we embed on somebody else's site.
//
// It does NOT sanitise HTML for re-injection. Output is plain text; never hand the
// intermediate HTML back to a browser.

const BLOCK_TAGS = 'address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  thinsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…', middot: '·', bull: '•',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±',
  times: '×', divide: '÷', frac12: '½', laquo: '«', raquo: '»',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü',
  ouml: 'ö', auml: 'ä', szlig: 'ß', ntilde: 'ñ', prime: '′',
  Prime: '″', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω', infin: '∞',
  ne: '≠', le: '≤', ge: '≥', minus: '−', rarr: '→', larr: '←',
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    const hit = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

// Remove elements whose content is never body prose.
function stripFurniture(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, '');
  const drop = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
                'form', 'button', 'select', 'textarea', 'nav', 'aside', 'header', 'footer'];
  for (const tag of drop) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ');
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/>`, 'gi'), ' ');
  }
  // Common chrome by class/id, matched only on the opening tag's attributes.
  s = s.replace(
    /<(div|section|ul|ol)\b[^>]*(?:class|id)\s*=\s*["'][^"']*\b(?:cookie|consent|banner|newsletter|subscribe|share|social|comment|related|recirc|promo|advert|sidebar|breadcrumb|pagination|skip-link|site-nav|menu)\b[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi,
    ' ');
  return s;
}

function tagsToText(fragment) {
  let s = fragment;
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, 'gi'), '\n\n');
  s = s.replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\r\n?/g, '\n')
       .replace(/[ \t ]+/g, ' ')
       .replace(/ *\n */g, '\n')
       .replace(/\n{3,}/g, '\n\n')
       .trim();
  return s;
}

// Pull every <tag ...>...</tag> at any depth, tolerating nesting of the same tag.
function findElements(html, tag) {
  const out = [];
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const both = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
  let m;
  while ((m = open.exec(html)) !== null) {
    both.lastIndex = m.index + m[0].length;
    let depth = 1, t;
    while ((t = both.exec(html)) !== null) {
      if (t[0][1] === '/') { depth--; if (depth === 0) break; } else depth++;
    }
    const end = t ? t.index + t[0].length : html.length;
    out.push(html.slice(m.index, end));
    open.lastIndex = m.index + m[0].length;                 // allow nested matches
  }
  return out;
}

// Score a candidate by how much of it is actual paragraph prose.
function proseScore(fragment) {
  const paras = findElements(fragment, 'p');
  let score = 0;
  for (const p of paras) {
    const t = tagsToText(p);
    if (t.length < 25) continue;                            // captions, bylines, labels
    score += t.length + Math.min(t.split(/[.!?]\s/).length, 12) * 15;
  }
  const linkText = findElements(fragment, 'a').reduce((n, a) => n + tagsToText(a).length, 0);
  const allText = tagsToText(fragment).length || 1;
  if (linkText / allText > 0.4) score *= 0.3;               // link farm, not an article
  return score;
}

function pickMain(html) {
  const candidates = [];
  for (const tag of ['article', 'main']) {
    for (const el of findElements(html, tag)) candidates.push(el);
  }
  for (const tag of ['div', 'section']) {
    for (const el of findElements(html, tag)) {
      if (el.length > 400) candidates.push(el);
    }
  }
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const s = proseScore(c);
    // Prefer the tighter container when scores tie closely — avoids grabbing <body>.
    if (s > bestScore * 1.05) { best = c; bestScore = s; }
  }
  const bodyScore = proseScore(html);
  if (!best || bestScore < bodyScore * 0.25) return html;
  return best;
}

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function pickTitle(html) {
  return firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || firstMatch(html, /<meta[^>]+name=["']citation_title["'][^>]+content=["']([^"']+)["']/i)
      || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
      || firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
}

function pickByline(html) {
  return firstMatch(html, /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i)
      || firstMatch(html, /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i)
      || firstMatch(html, /<meta[^>]+name=["']citation_author["'][^>]+content=["']([^"']+)["']/i);
}

function countWords(text) {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

// html -> { title, byline, text, words }
function extract(html, opts = {}) {
  const raw = String(html || '');
  const title = opts.title || pickTitle(raw);
  const byline = opts.byline || pickByline(raw);
  const stripped = stripFurniture(raw);
  const main = pickMain(stripped);
  let text = tagsToText(main);
  // Drop a leading duplicate of the title — most templates print it inside the article too.
  if (title && text.slice(0, title.length + 4).replace(/\s+/g, ' ').trim().startsWith(title)) {
    text = text.slice(title.length).replace(/^[\s\n]+/, '');
  }
  return { title, byline, text, words: countWords(text) };
}

module.exports = { extract, tagsToText, decodeEntities, stripFurniture, pickMain, pickTitle, countWords };
