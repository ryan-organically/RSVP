#!/usr/bin/env node
// Scrape NABRE Bible text from bible.usccb.org
// Output: public/nabre.txt

const fs = require('fs');
const path = require('path');

const BOOKS = [
  // Old Testament
  { name: 'Genesis', slug: 'genesis', chapters: 50 },
  { name: 'Exodus', slug: 'exodus', chapters: 40 },
  { name: 'Leviticus', slug: 'leviticus', chapters: 27 },
  { name: 'Numbers', slug: 'numbers', chapters: 36 },
  { name: 'Deuteronomy', slug: 'deuteronomy', chapters: 34 },
  { name: 'Joshua', slug: 'joshua', chapters: 24 },
  { name: 'Judges', slug: 'judges', chapters: 21 },
  { name: 'Ruth', slug: 'ruth', chapters: 4 },
  { name: '1 Samuel', slug: '1samuel', chapters: 31 },
  { name: '2 Samuel', slug: '2samuel', chapters: 24 },
  { name: '1 Kings', slug: '1kings', chapters: 22 },
  { name: '2 Kings', slug: '2kings', chapters: 25 },
  { name: '1 Chronicles', slug: '1chronicles', chapters: 29 },
  { name: '2 Chronicles', slug: '2chronicles', chapters: 36 },
  { name: 'Ezra', slug: 'ezra', chapters: 10 },
  { name: 'Nehemiah', slug: 'nehemiah', chapters: 13 },
  { name: 'Tobit', slug: 'tobit', chapters: 14 },
  { name: 'Judith', slug: 'judith', chapters: 16 },
  { name: 'Esther', slug: 'esther', chapters: 10 },
  { name: '1 Maccabees', slug: '1maccabees', chapters: 16 },
  { name: '2 Maccabees', slug: '2maccabees', chapters: 15 },
  { name: 'Job', slug: 'job', chapters: 42 },
  { name: 'Psalms', slug: 'psalms', chapters: 150 },
  { name: 'Proverbs', slug: 'proverbs', chapters: 31 },
  { name: 'Ecclesiastes', slug: 'ecclesiastes', chapters: 12 },
  { name: 'Song of Songs', slug: 'songofSongs', chapters: 8 },
  { name: 'Wisdom', slug: 'wisdom', chapters: 19 },
  { name: 'Sirach', slug: 'sirach', chapters: 51 },
  { name: 'Isaiah', slug: 'isaiah', chapters: 66 },
  { name: 'Jeremiah', slug: 'jeremiah', chapters: 52 },
  { name: 'Lamentations', slug: 'lamentations', chapters: 5 },
  { name: 'Baruch', slug: 'baruch', chapters: 6 },
  { name: 'Ezekiel', slug: 'ezekiel', chapters: 48 },
  { name: 'Daniel', slug: 'daniel', chapters: 14 },
  { name: 'Hosea', slug: 'hosea', chapters: 14 },
  { name: 'Joel', slug: 'joel', chapters: 4 },
  { name: 'Amos', slug: 'amos', chapters: 9 },
  { name: 'Obadiah', slug: 'obadiah', chapters: 1 },
  { name: 'Jonah', slug: 'jonah', chapters: 4 },
  { name: 'Micah', slug: 'micah', chapters: 7 },
  { name: 'Nahum', slug: 'nahum', chapters: 3 },
  { name: 'Habakkuk', slug: 'habakkuk', chapters: 3 },
  { name: 'Zephaniah', slug: 'zephaniah', chapters: 3 },
  { name: 'Haggai', slug: 'haggai', chapters: 2 },
  { name: 'Zechariah', slug: 'zechariah', chapters: 14 },
  { name: 'Malachi', slug: 'malachi', chapters: 3 },
  // New Testament
  { name: 'Matthew', slug: 'matthew', chapters: 28 },
  { name: 'Mark', slug: 'mark', chapters: 16 },
  { name: 'Luke', slug: 'luke', chapters: 24 },
  { name: 'John', slug: 'john', chapters: 21 },
  { name: 'Acts', slug: 'acts', chapters: 28 },
  { name: 'Romans', slug: 'romans', chapters: 16 },
  { name: '1 Corinthians', slug: '1corinthians', chapters: 16 },
  { name: '2 Corinthians', slug: '2corinthians', chapters: 13 },
  { name: 'Galatians', slug: 'galatians', chapters: 6 },
  { name: 'Ephesians', slug: 'ephesians', chapters: 6 },
  { name: 'Philippians', slug: 'philippians', chapters: 4 },
  { name: 'Colossians', slug: 'colossians', chapters: 4 },
  { name: '1 Thessalonians', slug: '1thessalonians', chapters: 5 },
  { name: '2 Thessalonians', slug: '2thessalonians', chapters: 3 },
  { name: '1 Timothy', slug: '1timothy', chapters: 6 },
  { name: '2 Timothy', slug: '2timothy', chapters: 4 },
  { name: 'Titus', slug: 'titus', chapters: 3 },
  { name: 'Philemon', slug: 'philemon', chapters: 1 },
  { name: 'Hebrews', slug: 'hebrews', chapters: 13 },
  { name: 'James', slug: 'james', chapters: 5 },
  { name: '1 Peter', slug: '1peter', chapters: 5 },
  { name: '2 Peter', slug: '2peter', chapters: 3 },
  { name: '1 John', slug: '1john', chapters: 5 },
  { name: '2 John', slug: '2john', chapters: 1 },
  { name: '3 John', slug: '3john', chapters: 1 },
  { name: 'Jude', slug: 'jude', chapters: 1 },
  { name: 'Revelation', slug: 'revelation', chapters: 22 },
];

const BASE = 'https://bible.usccb.org/bible';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractVerseText(html) {
  // Find the main content area
  const startMarker = 'id="scribeI"';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;

  let content = html.slice(startIdx);

  // Cut off at footnotes (class="fn") or endnotes (class="en")
  const fnIdx = content.indexOf('class="fn"');
  const enIdx = content.indexOf('class="en"');
  let cutoff = content.length;
  if (fnIdx > -1 && fnIdx < cutoff) cutoff = fnIdx;
  if (enIdx > -1 && enIdx < cutoff) cutoff = enIdx;
  // Back up to the start of the <p> tag containing the footnote
  const lastP = content.lastIndexOf('<p', cutoff);
  if (lastP > 0) cutoff = lastP;
  content = content.slice(0, cutoff);

  // Remove footnote references (fnref) and endnote references (enref)
  content = content.replace(/<a\s+class="fnref"[^>]*>[\s\S]*?<\/a>/gi, '');
  content = content.replace(/<a\s+class="enref"[^>]*>[\s\S]*?<\/a>/gi, '');

  // Keep verse numbers from <span class="bcv">
  content = content.replace(/<span class="bcv">(\d+)<\/span>/g, '$1 ');

  // Remove the opening tag remnant
  content = content.replace(/^id="scribeI">/, '');

  // Remove chapter heading (we add our own)
  content = content.replace(/<h3[^>]*>.*?<\/h3>/gi, '');

  // Convert <p> and <br> to newlines
  content = content.replace(/<\/p>/gi, '\n\n');
  content = content.replace(/<br\s*\/?>/gi, '\n');

  // Remove all remaining HTML tags
  content = content.replace(/<[^>]+>/g, '');

  // Decode entities
  content = content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '\u2019').replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/&#\d+;/g, '');

  // Clean up whitespace
  content = content.replace(/[ \t]+/g, ' ');
  content = content.replace(/\n[ \t]+/g, '\n');
  content = content.replace(/\n{3,}/g, '\n\n');

  return content.trim();
}

async function fetchChapter(slug, chapter, retries = 2) {
  const url = `${BASE}/${slug}/${chapter}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          'Accept': 'text/html',
        }
      });
      if (!res.ok) {
        if (attempt < retries) { await sleep(2000); continue; }
        console.error(`  HTTP ${res.status} for ${url}`);
        return null;
      }
      const html = await res.text();
      return extractVerseText(html);
    } catch (e) {
      if (attempt < retries) { await sleep(2000); continue; }
      console.error(`  Error fetching ${url}: ${e.message}`);
      return null;
    }
  }
}

async function main() {
  const outPath = path.join(__dirname, 'public', 'nabre.txt');
  const output = [];
  const totalChapters = BOOKS.reduce((s, b) => s + b.chapters, 0);
  let done = 0;
  let failed = 0;

  output.push('THE NEW AMERICAN BIBLE \u2014 REVISED EDITION (NABRE)');
  output.push('\n' + '='.repeat(60) + '\n');

  for (const book of BOOKS) {
    console.log(`\n${book.name} (${book.chapters} chapters)`);
    output.push('\n\n' + '='.repeat(60));
    output.push(`\n${book.name.toUpperCase()}\n`);
    output.push('='.repeat(60) + '\n');

    for (let ch = 1; ch <= book.chapters; ch++) {
      const text = await fetchChapter(book.slug, ch);
      done++;
      const pct = ((done / totalChapters) * 100).toFixed(1);

      if (text && text.length > 10) {
        output.push(`\nChapter ${ch}\n\n`);
        output.push(text + '\n');
        process.stdout.write(`  Ch ${ch}/${book.chapters} OK (${pct}% total)    \r`);
      } else {
        failed++;
        console.log(`  Ch ${ch}/${book.chapters} - FAILED`);
      }

      // Rate limit: 400ms between requests
      await sleep(400);
    }
    console.log();
  }

  fs.writeFileSync(outPath, output.join(''), 'utf8');
  const sizeMB = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
  console.log(`\nDone! Saved to ${outPath} (${sizeMB} MB)`);
  console.log(`${done} chapters processed, ${failed} failed`);
}

main().catch(console.error);
