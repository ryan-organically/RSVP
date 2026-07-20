// ── State ──────────────────────────────────────────────────
const S = {
  library: [],       // [{id, title, wordCount, source, addedAt}]
  textCache: {},     // id -> text string (in-memory)
  currentBook: null,
  words: [],
  chapters: [],
  wordIndex: 0,
  playing: false,
  wpm: 300,
  fontSize: 64,
  theme: 'dark',
  accelMode: false,
  accelTarget: 600,
  accelStart: null,
  accelDuration: 30,
  timer: null,
  sessionWordsRead: 0,
  sessionStartTime: null,
};

// ── IndexedDB Cache ──────────────────────────────────────
const IDB = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('rsvp-cache', 2);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (db.objectStoreNames.contains('texts')) db.deleteObjectStore('texts');
        db.createObjectStore('texts');
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async get(key) {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction('texts', 'readonly');
        const req = tx.objectStore('texts').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  },
  async set(key, value) {
    try {
      const db = await this.open();
      const tx = db.transaction('texts', 'readwrite');
      tx.objectStore('texts').put(value, key);
    } catch { /* silent */ }
  },
  async del(key) {
    try {
      const db = await this.open();
      const tx = db.transaction('texts', 'readwrite');
      tx.objectStore('texts').delete(key);
    } catch { /* silent */ }
  }
};

const GUTENBERG_API = 'https://gutendex.com/books';
const PUNCT = {'.':2.5,'!':2.5,'?':2.5,',':1.5,';':1.8,':':1.8,'—':1.4,'–':1.4};
function saveSettings() {
  try {
    localStorage.setItem('rsvp-settings', JSON.stringify({
      wpm: S.wpm, fontSize: S.fontSize, theme: S.theme,
      accelMode: S.accelMode, accelTarget: S.accelTarget,
      lastBook: S.currentBook ? S.currentBook.id : undefined,
      accent: S.accent
    }));
  } catch {}
}
function loadSettings() {
  try {
    const raw = localStorage.getItem('rsvp-settings');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.wpm) S.wpm = s.wpm;
    if (s.fontSize) S.fontSize = s.fontSize;
    if (s.theme) S.theme = s.theme;
    if (s.accelTarget) S.accelTarget = s.accelTarget;
    if (s.lastBook) S.lastBook = s.lastBook;
    if (s.accent) S.accent = s.accent;
  } catch {}
}
const FEATURED_BOOKS = [
  { cat: 'Essential Classics', books: [
    { id:84, t:'Frankenstein', a:'Mary Shelley', dl:150546 },
    { id:768, t:'Wuthering Heights', a:'Emily Bront\u00eb', dl:102455 },
    { id:1342, t:'Pride and Prejudice', a:'Jane Austen', dl:86747 },
    { id:2554, t:'Crime and Punishment', a:'Fyodor Dostoyevsky', dl:50199 },
    { id:1260, t:'Jane Eyre', a:'Charlotte Bront\u00eb', dl:45255 },
    { id:174, t:'The Picture of Dorian Gray', a:'Oscar Wilde', dl:35817 },
    { id:28054, t:'The Brothers Karamazov', a:'Fyodor Dostoyevsky', dl:31896 },
    { id:98, t:'A Tale of Two Cities', a:'Charles Dickens', dl:31646 },
    { id:1400, t:'Great Expectations', a:'Charles Dickens', dl:24542 },
    { id:2600, t:'War and Peace', a:'Leo Tolstoy', dl:23619 },
    { id:4300, t:'Ulysses', a:'James Joyce', dl:23057 },
    { id:1399, t:'Anna Karenina', a:'Leo Tolstoy', dl:18689 },
    { id:135, t:'Les Mis\u00e9rables', a:'Victor Hugo', dl:16589 },
  ]},
  { cat: 'Adventure & Fantasy', books: [
    { id:11, t:'Alice in Wonderland', a:'Lewis Carroll', dl:52940 },
    { id:1184, t:'The Count of Monte Cristo', a:'Alexandre Dumas', dl:36464 },
    { id:1661, t:'Sherlock Holmes', a:'Arthur Conan Doyle', dl:28773 },
    { id:120, t:'Treasure Island', a:'Robert Louis Stevenson', dl:21555 },
    { id:55, t:'The Wonderful Wizard of Oz', a:'L. Frank Baum', dl:18777 },
    { id:2852, t:'Hound of the Baskervilles', a:'Arthur Conan Doyle', dl:16426 },
    { id:996, t:'Don Quixote', a:'Miguel de Cervantes', dl:15477 },
    { id:829, t:'Gulliver\u2019s Travels', a:'Jonathan Swift', dl:14334 },
    { id:164, t:'20,000 Leagues Under the Sea', a:'Jules Verne', dl:10506 },
    { id:35, t:'The Time Machine', a:'H. G. Wells', dl:10491 },
    { id:215, t:'The Call of the Wild', a:'Jack London', dl:9260 },
    { id:103, t:'Around the World in 80 Days', a:'Jules Verne', dl:7966 },
  ]},
  { cat: 'Philosophy & Science', books: [
    { id:1998, t:'Thus Spoke Zarathustra', a:'Nietzsche', dl:26832 },
    { id:205, t:'Walden', a:'Henry David Thoreau', dl:26565 },
    { id:3207, t:'Leviathan', a:'Thomas Hobbes', dl:24927 },
    { id:1232, t:'The Prince', a:'Machiavelli', dl:24801 },
    { id:4363, t:'Beyond Good and Evil', a:'Nietzsche', dl:22442 },
    { id:2680, t:'Meditations', a:'Marcus Aurelius', dl:19220 },
    { id:1497, t:'The Republic', a:'Plato', dl:18489 },
    { id:132, t:'The Art of War', a:'Sun Tzu', dl:11911 },
    { id:3300, t:'The Wealth of Nations', a:'Adam Smith', dl:11876 },
    { id:8438, t:'Nicomachean Ethics', a:'Aristotle', dl:10924 },
    { id:1228, t:'On the Origin of Species', a:'Charles Darwin', dl:9430 },
    { id:61, t:'The Communist Manifesto', a:'Karl Marx', dl:7174 },
    { id:2130, t:'Utopia', a:'Thomas More', dl:4089 },
  ]},
  { cat: 'Horror & Gothic', books: [
    { id:43, t:'Dr. Jekyll and Mr. Hyde', a:'R. L. Stevenson', dl:55107 },
    { id:8492, t:'The King in Yellow', a:'Robert W. Chambers', dl:38701 },
    { id:345, t:'Dracula', a:'Bram Stoker', dl:31767 },
    { id:1952, t:'The Yellow Wallpaper', a:'Charlotte Perkins Gilman', dl:24101 },
    { id:5200, t:'Metamorphosis', a:'Franz Kafka', dl:22516 },
    { id:219, t:'Heart of Darkness', a:'Joseph Conrad', dl:14434 },
    { id:36, t:'The War of the Worlds', a:'H. G. Wells', dl:10335 },
  ]},
  { cat: 'Poetry & Drama', books: [
    { id:1513, t:'Romeo and Juliet', a:'Shakespeare', dl:69731 },
    { id:16328, t:'Beowulf', a:'Unknown', dl:44066 },
    { id:6130, t:'The Iliad', a:'Homer', dl:26270 },
    { id:1727, t:'The Odyssey', a:'Homer', dl:20234 },
    { id:8800, t:'The Divine Comedy', a:'Dante Alighieri', dl:18358 },
    { id:26, t:'Paradise Lost', a:'John Milton', dl:14857 },
    { id:1524, t:'Hamlet', a:'Shakespeare', dl:13347 },
    { id:1322, t:'Leaves of Grass', a:'Walt Whitman', dl:9126 },
    { id:228, t:'The Aeneid', a:'Virgil', dl:5733 },
    { id:1533, t:'Macbeth', a:'Shakespeare', dl:5655 },
    { id:1531, t:'Othello', a:'Shakespeare', dl:2192 },
    { id:1532, t:'King Lear', a:'Shakespeare', dl:2072 },
  ]},
];

async function fetchRetry(url, opts, retries=2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok || res.status < 500) return res;
      if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function showToast(msg, ms=2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

// ── Storage (Database API) ─────────────────────────────────
function saveLib() {
  // No-op: library is persisted server-side now
}
async function loadLib() {
  try {
    const res = await fetchRetry('/api/books');
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(r => ({
      id: r.id, title: r.title,
      wordCount: r.word_count, source: r.source,
      addedAt: r.added_at, wordIndex: r.word_index || 0
    }));
  } catch(e) { console.warn('loadLib:', e); return []; }
}
async function saveBook(id, title, wordCount, source, content) {
  try {
    await fetchRetry('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title, wordCount, source, content })
    });
  } catch(e) { console.warn('saveBook:', e); }
}
function saveText(id, text) {
  // Text is saved together with book via saveBook — no-op for compat
}
async function loadText(id) {
  if (S.textCache[id]) return S.textCache[id];
  const cached = await IDB.get(id);
  if (cached && cached.length > 500) { S.textCache[id] = cached; return cached; }
  try {
    const res = await fetchRetry('/api/books/' + encodeURIComponent(id) + '/text');
    if (!res.ok) return null;
    const text = await res.text();
    if (text) { S.textCache[id] = text; await IDB.set(id, text); }
    return text || null;
  } catch { return null; }
}

let _bmSaveTimer = null;
function saveBM(id, idx) {
  clearTimeout(_bmSaveTimer);
  _bmSaveTimer = setTimeout(() => {
    fetch('/api/books/' + encodeURIComponent(id) + '/position', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wordIndex: idx })
    }).catch(e => console.warn('saveBM:', e));
  }, 2000);
}
function saveBMNow(id, idx) {
  clearTimeout(_bmSaveTimer);
  fetch('/api/books/' + encodeURIComponent(id) + '/position', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wordIndex: idx })
  }).catch(e => console.warn('saveBM:', e));
}
function loadBM(id) {
  const meta = S.library.find(b => b.id === id);
  return meta ? (meta.wordIndex || 0) : 0;
}

// ── Helpers ────────────────────────────────────────────────
function stripGutenberg(text) {
  // Strip header (everything up to and including *** START OF ... ***)
  const startMatch = text.match(/\*{3}\s*START OF.*?\*{3}/i);
  if (startMatch) text = text.slice(text.indexOf(startMatch[0]) + startMatch[0].length);
  // Strip footer (everything from *** END OF ... *** onward)
  const endMatch = text.match(/\*{3}\s*END OF.*?\*{3}/i);
  if (endMatch) text = text.slice(0, text.indexOf(endMatch[0]));
  return text.trim();
}
function tokenize(t) {
  return t.split(/\s+/).filter(w => w.length > 0 && /[a-zA-Z0-9]/.test(w));
}
async function tokenizeAsync(t) {
  const raw = t.split(/\s+/);
  const words = [];
  const CHUNK = 50000;
  for (let i = 0; i < raw.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, raw.length);
    for (let j = i; j < end; j++) {
      if (raw[j].length > 0 && /[a-zA-Z0-9]/.test(raw[j])) words.push(raw[j]);
    }
    if (i + CHUNK < raw.length) await new Promise(r => setTimeout(r, 0));
  }
  return words;
}
function calcORP(word) {
  const len = word.replace(/[^a-zA-Z0-9]/g,'').length;
  if (len <= 1) return 0;
  return Math.floor(len / 2);
}
function wordDelay(word, baseMs) {
  let m=1; const last=word[word.length-1];
  if (PUNCT[last]) m=PUNCT[last];
  if (word.length>8) m=Math.max(m,1.3);
  return baseMs*m;
}
function detectChapters(text) {
  // Bible detection: check for KJV Gutenberg structure
  if (text.includes('The First Book of Moses') && text.includes('The Revelation of Saint John')) {
    return detectBibleBooks(text);
  }
  // NABRE detection
  if (text.includes('NEW AMERICAN BIBLE') && text.includes('REVISED EDITION')) {
    return detectNabreBooks(text);
  }
  const lines=text.split('\n'), chs=[{title:'Start',index:0}];
  let wc=0;
  for (const line of lines) {
    const t=line.trim();
    const isHeading = /^(chapter|part|section|book)\s+[\divxlc]+/i.test(t);
    const isAllCaps = /^[A-Z][A-Z\s:.\-—]+$/.test(t) && t.length>8 && t.length<80 && t.includes(' ');
    if ((isHeading || isAllCaps) && wc>0)
      chs.push({title:t.slice(0,60),index:wc});
    wc+=t.split(/\s+/).filter(w=>w).length;
  }
  return chs;
}
function detectBibleBooks(text) {
  const bibleSeq = [
    ['The First Book of Moses: Called Genesis','Genesis'],
    ['The Second Book of Moses: Called Exodus','Exodus'],
    ['The Third Book of Moses: Called Leviticus','Leviticus'],
    ['The Fourth Book of Moses: Called Numbers','Numbers'],
    ['The Fifth Book of Moses: Called Deuteronomy','Deuteronomy'],
    ['The Book of Joshua','Joshua'],['The Book of Judges','Judges'],['The Book of Ruth','Ruth'],
    ['The First Book of Samuel','1 Samuel'],['The Second Book of Samuel','2 Samuel'],
    ['The First Book of the Kings','1 Kings',2],['The Second Book of the Kings','2 Kings',2],
    ['The First Book of the Chronicles','1 Chronicles'],['The Second Book of the Chronicles','2 Chronicles'],
    ['Ezra','Ezra'],['The Book of Nehemiah','Nehemiah'],['The Book of Esther','Esther'],
    ['The Book of Job','Job'],['The Book of Psalms','Psalms'],['The Proverbs','Proverbs'],
    ['Ecclesiastes','Ecclesiastes'],['The Song of Solomon','Song of Solomon'],
    ['The Book of the Prophet Isaiah','Isaiah'],['The Book of the Prophet Jeremiah','Jeremiah'],
    ['The Lamentations of Jeremiah','Lamentations'],['The Book of the Prophet Ezekiel','Ezekiel'],
    ['The Book of Daniel','Daniel'],
    ['Hosea','Hosea'],['Joel','Joel'],['Amos','Amos'],['Obadiah','Obadiah'],
    ['Jonah','Jonah'],['Micah','Micah'],['Nahum','Nahum'],['Habakkuk','Habakkuk'],
    ['Zephaniah','Zephaniah'],['Haggai','Haggai'],['Zechariah','Zechariah'],['Malachi','Malachi'],
    ['The Gospel According to Saint Matthew','Matthew'],['The Gospel According to Saint Mark','Mark'],
    ['The Gospel According to Saint Luke','Luke'],['The Gospel According to Saint John','John'],
    ['The Acts of the Apostles','Acts'],
    ['The Epistle of Paul the Apostle to the Romans','Romans'],
    ['The First Epistle of Paul the Apostle to the Corinthians','1 Corinthians'],
    ['The Second Epistle of Paul the Apostle to the Corinthians','2 Corinthians'],
    ['The Epistle of Paul the Apostle to the Galatians','Galatians'],
    ['The Epistle of Paul the Apostle to the Ephesians','Ephesians'],
    ['The Epistle of Paul the Apostle to the Philippians','Philippians'],
    ['The Epistle of Paul the Apostle to the Colossians','Colossians'],
    ['The First Epistle of Paul the Apostle to the Thessalonians','1 Thessalonians'],
    ['The Second Epistle of Paul the Apostle to the Thessalonians','2 Thessalonians'],
    ['The First Epistle of Paul the Apostle to Timothy','1 Timothy'],
    ['The Second Epistle of Paul the Apostle to Timothy','2 Timothy'],
    ['The Epistle of Paul the Apostle to Titus','Titus'],
    ['The Epistle of Paul the Apostle to Philemon','Philemon'],
    ['The Epistle of Paul the Apostle to the Hebrews','Hebrews'],
    ['The General Epistle of James','James'],
    ['The First Epistle General of Peter','1 Peter'],['The Second General Epistle of Peter','2 Peter'],
    ['The First Epistle General of John','1 John'],['The Second Epistle General of John','2 John'],
    ['The Third Epistle General of John','3 John'],
    ['The General Epistle of Jude','Jude'],
    ['The Revelation of Saint John the Divine','Revelation'],
  ];
  const lines=text.split('\n'), occ={}, chs=[{title:'Start',index:0}];
  const entries=bibleSeq.map(e=>({match:e[0],name:e[1],need:e[2]||1,found:false}));
  let wc=0;
  for (const line of lines) {
    const t=line.trim();
    if (wc>500) {
      for (const e of entries) {
        if (!e.found && t===e.match) {
          occ[e.match]=(occ[e.match]||0)+1;
          if (occ[e.match]===e.need) { e.found=true; chs.push({title:e.name,index:wc,subchapters:[]}); }
          break;
        }
      }
    }
    wc+=t.split(/\s+/).filter(w=>w).length;
  }
  // Second pass: find chapter:verse markers and attach to parent books
  wc=0;
  const verseRe=/^(\d+):1\s/;
  for (const line of lines) {
    const t=line.trim();
    const vm=t.match(verseRe);
    if (vm && wc>500) {
      const chapNum=parseInt(vm[1]);
      // Find which book this belongs to
      let parent=null;
      for (let i=chs.length-1;i>=1;i--) {
        if (wc>=chs[i].index) { parent=chs[i]; break; }
      }
      if (parent && parent.subchapters) {
        // Only add if this is the first verse of a new chapter (X:1)
        if (!parent.subchapters.some(s=>s.num===chapNum)) {
          parent.subchapters.push({title:'Chapter '+chapNum,num:chapNum,index:wc});
        }
      }
    }
    wc+=t.split(/\s+/).filter(w=>w).length;
  }
  return chs;
}
function detectNabreBooks(text) {
  const lines=text.split('\n'), chs=[];
  const sepLine='============================================================';
  let wc=0, currentBook=null;
  for (let i=0;i<lines.length;i++) {
    const t=lines[i].trim();
    // Detect book name: ALL CAPS line between === separators
    if (t===sepLine && i+2<lines.length && lines[i+2].trim()===sepLine) {
      const bookName=lines[i+1].trim();
      if (/^[A-Z0-9 ]+$/.test(bookName) && bookName.length>1 && bookName!==sepLine) {
        // Title-case the book name (keep small words lowercase)
        const small=new Set(['of','the','and','in','to','a']);
        const title=bookName.replace(/\w\S*/g, (w,i)=>{const lc=w.toLowerCase();return i>0&&small.has(lc)?lc:lc[0].toUpperCase()+lc.slice(1);});
        currentBook={title,index:wc,subchapters:[]};
        chs.push(currentBook);
      }
    }
    // Detect chapter heading
    const chMatch=t.match(/^Chapter\s+(\d+)$/);
    if (chMatch && currentBook) {
      currentBook.subchapters.push({title:'Chapter '+chMatch[1],num:parseInt(chMatch[1]),index:wc});
    }
    wc+=t.split(/\s+/).filter(w=>w).length;
  }
  return chs;
}

// ── Rendering ──────────────────────────────────────────────
let _wordAreaCenter = 0;
let _wordEl = null;
let _progressFill = null;
let _wordCountEl = null;
let _lastProgressText = '';
function cacheWordArea() {
  const area = document.getElementById('wordArea');
  if (area) {
    const rect = area.getBoundingClientRect();
    _wordAreaCenter = rect.left + rect.width / 2;
  }
  _wordEl = document.getElementById('wordDisplay');
}
window.addEventListener('resize', () => { cacheWordArea(); if (_minimapDrawn) drawMinimap(); });

function dismissHint() {
  const h = document.getElementById('keyhint');
  if (h) h.remove();
}
function renderWord(word, size) {
  dismissHint();
  const el = _wordEl || document.getElementById('wordDisplay');
  if (!word) { el.innerHTML=''; return; }
  el.style.fontSize = size+'px';
  const clean = word.replace(/[^a-zA-Z0-9'''-]/g,'');
  const orpIdx = calcORP(clean);
  let cc=0, before='', orp='', after='';
  for (let i=0;i<word.length;i++) {
    const ch=word[i], isA=/[a-zA-Z0-9]/.test(ch);
    if (isA) {
      if (cc<orpIdx) before+=ch; else if (cc===orpIdx) orp+=ch; else after+=ch; cc++;
    } else {
      if (cc<=orpIdx) before+=ch; else after+=ch;
    }
  }
  el.innerHTML = `<span class="orp-before">${esc(before)}</span><span class="orp">${esc(orp)}</span><span class="orp-after">${esc(after)}</span>`;
  // Pin ORP character at horizontal center of word-area
  el.style.setProperty('--orp-offset', '0px');
  requestAnimationFrame(() => {
    const orpEl = el.querySelector('.orp');
    if (!orpEl) return;
    const areaCenter = _wordAreaCenter;
    const orpRect = orpEl.getBoundingClientRect();
    const orpCenter = orpRect.left + orpRect.width / 2;
    el.style.setProperty('--orp-offset', (areaCenter - orpCenter) + 'px');
  });
  if (S.digestMode) updateDigestIndicator();
}
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function updateProgress() {
  const pct = S.words.length>0 ? (S.wordIndex/S.words.length)*100 : 0;
  if (!_progressFill) _progressFill = document.getElementById('progressFill');
  _progressFill.style.transform = 'scaleX(' + (pct/100) + ')';

  let info;
  if (S.digestMode && S.digestBoundaries) {
    const block = getCurrentDigestBlock();
    const blockNum = block ? block.blockIdx + 1 : 1;
    const total = S.digestBlocks.length;
    const wordsLeft = S.words.length - S.wordIndex;
    const secsLeft = Math.ceil(wordsLeft / (S.wpm / 60));
    const timeStr = secsLeft > 60 ? `~${Math.ceil(secsLeft/60)}m` : `~${secsLeft}s`;
    info = `Block ${blockNum}/${total} \u00b7 ${timeStr}`;
  } else {
    const left = Math.ceil((S.words.length-S.wordIndex)/S.wpm);
    info = `${S.wordIndex.toLocaleString()} / ${S.words.length.toLocaleString()} \u00b7 ~${left}m`;
  }
  if (info !== _lastProgressText) {
    if (!_wordCountEl) _wordCountEl = document.getElementById('wordCount');
    _wordCountEl.textContent = info;
    _lastProgressText = info;
  }
  // Update page title with progress
  if (S.currentBook) {
    const titlePct = S.words.length > 0 ? Math.round((S.wordIndex / S.words.length) * 100) : 0;
    document.title = `${titlePct}% · ${S.currentBook.title} · RSVP`;
  }
  if (_minimapDrawn) updateMinimapViewport();
}
function updatePlayBtn() {
  const b=document.getElementById('playBtn');
  if (b) { b.textContent = S.playing ? '❚❚' : '▶'; b.classList.toggle('playing', S.playing); }
  const sb=document.getElementById('sidePlayBtn');
  if (sb) { sb.textContent = S.playing ? '❚❚' : '▶'; sb.classList.toggle('playing', S.playing); }
}

const BOOK_TAGS = {
  book:    { label: 'Book',       bg: '#1e3a5f', fg: '#7eb8e0' },
  bible:   { label: 'Bible',      bg: '#352454', fg: '#b09ad8' },
  digest:  { label: 'Dev Digest', bg: '#1a3a2a', fg: '#6ec99a' },
  article: { label: 'Article',    bg: '#3d2e10', fg: '#c8a44e' },
  paper:   { label: 'Paper',      bg: '#3d1a1a', fg: '#d08080' },
  notes:   { label: 'Notes',      bg: '#2a2a2a', fg: '#9a9a9a' },
};
function loadBookTags() { try { return JSON.parse(localStorage.getItem('rsvp-tags')||'{}'); } catch { return {}; } }
function saveBookTag(bookId, tag) { const t=loadBookTags(); t[bookId]=tag; localStorage.setItem('rsvp-tags',JSON.stringify(t)); }
function guessTag(b) {
  const t=b.title.toLowerCase();
  if (t.includes('bible')||t.includes('nabre')||t.includes('testament')) return 'bible';
  if (b.source==='bundled'&&(t.includes('digest')||t.includes('verdict'))) return 'digest';
  if (t.includes('digest')||t.includes('sprint')||t.includes('standup')) return 'digest';
  return 'book';
}
function getBookTag(b) { return loadBookTags()[b.id] || guessTag(b); }
function tagPillHtml(bookId, tag) {
  const t=BOOK_TAGS[tag]||BOOK_TAGS.book;
  const opts=Object.entries(BOOK_TAGS).map(([k,v])=>`<span class="tag-opt${k===tag?' selected':''}" data-tag="${k}" data-bookid="${bookId}" style="background:${v.bg};color:${v.fg}">${v.label}</span>`).join('');
  return `<span class="tag-pill" data-bookid="${bookId}" style="background:${t.bg};color:${t.fg}">${t.label}</span><div class="tag-picker" id="tagpick-${bookId}">${opts}</div>`;
}

function renderLibrary() {
  const el=document.getElementById('bookList');
  if (S.library.length===0) {
    el.innerHTML='<div class="empty-state"><div class="empty-icon">📚</div><p>No books yet. Upload a file or search the Free Library tab.</p></div>';
    return;
  }
  const sourceLabel = s => s==='gutenberg'?'Gutenberg':s==='bundled'?'Bundled':'Import';
  const formatWords = n => n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?Math.round(n/1000)+'K':n.toString();
  const rows = S.library.map(b => {
    const bm = loadBM(b.id);
    const wc = b.wordCount || 0;
    const pct = wc > 0 && bm > 0 ? Math.round((bm / wc) * 100) : 0;
    const progressHtml = pct > 0
      ? `<span class="progress-bar"><span class="progress-fill" style="width:${pct}%"></span></span>${pct}%`
      : '';
    const tag = getBookTag(b);
    return `<tr class="book-row" data-bookid="${b.id}">
      <td>${esc(b.title)}</td>
      <td class="col-tag">${tagPillHtml(b.id, tag)}</td>
      <td class="col-words">${formatWords(wc)}</td>
      <td class="col-source">${sourceLabel(b.source)}</td>
      <td class="col-progress">${progressHtml}</td>
      <td class="row-menu"><span class="menu-dots" data-menuid="${b.id}">···</span><div class="row-dropdown" id="menu-${b.id}"><button class="drop-delete" data-delid="${b.id}">Delete</button></div></td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="book-table">
    <thead><tr><th>Title</th><th>Tag</th><th>Words</th><th class="col-source">Source</th><th style="text-align:right">Progress</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  el.querySelectorAll('.book-row').forEach(row => {
    row.addEventListener('click', function(e) {
      if (e.target.closest('.menu-dots') || e.target.closest('.row-dropdown') || e.target.closest('.col-tag')) {
        e.stopPropagation();
        return;
      }
      openBook(this.dataset.bookid);
    });
  });
  el.querySelectorAll('.tag-pill').forEach(pill => {
    pill.addEventListener('click', function(e) {
      e.stopPropagation();
      const id = this.dataset.bookid;
      const picker = document.getElementById('tagpick-'+id);
      const wasOpen = picker.classList.contains('open');
      document.querySelectorAll('.tag-picker.open').forEach(p => p.classList.remove('open'));
      if (!wasOpen) picker.classList.add('open');
    });
  });
  el.querySelectorAll('.tag-opt').forEach(opt => {
    opt.addEventListener('click', function(e) {
      e.stopPropagation();
      saveBookTag(this.dataset.bookid, this.dataset.tag);
      document.querySelectorAll('.tag-picker.open').forEach(p => p.classList.remove('open'));
      renderLibrary();
    });
  });
  el.querySelectorAll('.menu-dots').forEach(dot => {
    dot.addEventListener('click', function(e) {
      e.stopPropagation();
      const id = this.dataset.menuid;
      const dd = document.getElementById('menu-'+id);
      const wasOpen = dd.classList.contains('open');
      document.querySelectorAll('.row-dropdown.open').forEach(d => d.classList.remove('open'));
      if (!wasOpen) dd.classList.add('open');
    });
  });
  el.querySelectorAll('.drop-delete').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      document.querySelectorAll('.row-dropdown.open').forEach(d => d.classList.remove('open'));
      confirmDelete(this.dataset.delid);
    });
  });
}

function filterLibrary(q) {
  q = q.toLowerCase().trim();
  document.querySelectorAll('#bookList .book-row').forEach(row => {
    const title = row.querySelector('td')?.textContent.toLowerCase() || '';
    row.style.display = !q || title.includes(q) ? '' : 'none';
  });
}

// ── Book operations ────────────────────────────────────────
function showLoading(msg, progress) {
  document.getElementById('loadingMsg').textContent = msg||'Loading...';
  document.getElementById('loadingOverlay').classList.remove('hidden');
  const bar = document.getElementById('loadingProgress');
  if (bar) {
    if (typeof progress === 'number') {
      bar.style.display = 'block';
      bar.style.width = progress + '%';
    } else {
      bar.style.display = 'none';
    }
  }
}
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

async function openBook(id) {
  const meta = S.library.find(b=>b.id===id);
  if (!meta) return;
  showLoading('Loading book...');

  // 1. Memory cache
  let text = S.textCache[id] || null;
  // 2. Database
  if (!text) text = await loadText(id);
  // 3. Re-fetch from Gutenberg
  if (!text && meta.source==='gutenberg') {
    showLoading('Re-downloading from Project Gutenberg...');
    text = await fetchGutenbergText(meta.title.split('—')[0].trim());
    if (text) { S.textCache[id]=text; IDB.set(id, text); await saveBook(id, meta.title, meta.wordCount, meta.source, text); }
  }
  if (!text) { hideLoading(); alert('Could not load book. Try deleting and re-adding it.'); return; }

  S.textCache[id]=text; IDB.set(id, text);
  S.currentBook=meta;
  saveSettings();
  const bodyText = stripGutenberg(text);
  S.words = await tokenizeAsync(bodyText);
  S.chapters=detectChapters(bodyText);
  S.wordIndex=Math.min(loadBM(id), S.words.length-1);
  S.playing=false;
  S.sessionWordsRead = 0;
  S.sessionStartTime = null;

  try {
    // Switch to reader
    document.getElementById('libraryView').classList.remove('active');
    document.getElementById('readerView').classList.add('active');
    document.getElementById('readerBookTitle').textContent=meta.title;

    cacheWordArea();
    renderWord(S.words[S.wordIndex], S.fontSize);
    updateProgress(); updatePlayBtn();

    // Render TOC sidebar
    renderTOC();
    drawMinimap();
    renderBookmarks();
  } finally {
    hideLoading();
  }
}

function renderTOC() {
  const tocList = document.getElementById('tocList');
  const tocCount = document.getElementById('tocCount');
  const chapters = S.chapters || [];
  tocCount.textContent = chapters.length > 1 ? chapters.length + ' chapters' : '';

  if (chapters.length <= 1 && !S.digestMode) {
    tocList.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--dim);text-align:center">No chapters detected</div>';
    return;
  }

  const cur = [...chapters].reverse().find(c => S.wordIndex >= c.index);
  tocList.innerHTML = chapters.map((ch, i) => {
    const nextIdx = i < chapters.length - 1 ? chapters[i + 1].index : S.words.length;
    const chapterWords = nextIdx - ch.index;
    const isCurrent = cur === ch;
    const isBookmarked = isCurrent && S.wordIndex > ch.index;
    const wordsInto = Math.max(0, S.wordIndex - ch.index);
    const pct = chapterWords > 0 ? Math.round((wordsInto / chapterWords) * 100) : 0;
    const minsLeft = Math.ceil((chapterWords - wordsInto) / S.wpm);

    let icon = '';
    if (isBookmarked) icon = '\u{1F516}';
    else if (isCurrent) icon = '\u25B6';

    let cls = 'chapter-item';
    if (isCurrent) cls += ' active';
    if (isBookmarked) cls += ' bookmarked';
    if (ch.subchapters && ch.subchapters.length > 0) cls += ' has-sub';

    const tooltip = isCurrent
      ? `${wordsInto.toLocaleString()} / ${chapterWords.toLocaleString()} words \u00B7 ${pct}% \u00B7 ~${minsLeft} min left`
      : `${chapterWords.toLocaleString()} words \u00B7 ~${Math.ceil(chapterWords / S.wpm)} min`;

    const progressText = isCurrent ? pct + '%' : '';

    let subHtml = '';
    if (ch.subchapters && ch.subchapters.length > 0) {
      const isOpen = isCurrent || (S._openAccordions && S._openAccordions.has(i));
      subHtml = `<div class="sub-chapters${isOpen ? ' open' : ''}" id="sub-${i}">` +
        ch.subchapters.map(sc => {
          const scActive = S.wordIndex >= sc.index && (ch.subchapters.indexOf(sc) === ch.subchapters.length - 1 || S.wordIndex < ch.subchapters[ch.subchapters.indexOf(sc) + 1].index);
          return `<div class="sub-chapter${scActive ? ' active' : ''}" onclick="event.stopPropagation();jumpTo(${sc.index})">${sc.title}</div>`;
        }).join('') + '</div>';
    }

    const toggleSub = ch.subchapters && ch.subchapters.length > 0
      ? `onclick="toggleAccordion(${i}, ${ch.index})"`
      : `onclick="jumpTo(${ch.index})"`;

    return `<div class="chapter-group">
      <div class="${cls}" ${toggleSub}>
        <span class="chapter-icon">${icon}</span>
        <span class="chapter-label">${esc(ch.title)}</span>
        ${ch.subchapters && ch.subchapters.length > 0 ? `<span class="chapter-arrow">${(isCurrent || (S._openAccordions && S._openAccordions.has(i))) ? '\u25BE' : '\u25B8'}</span>` : ''}
        ${progressText ? `<span class="chapter-progress">${progressText}</span>` : ''}
        <span class="chapter-tooltip">${esc(tooltip)}</span>
      </div>${subHtml}
    </div>`;
  }).join('');

  // Scroll active chapter into view
  const active = tocList.querySelector('.chapter-item.active');
  if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  // Update mobile chapter indicator
  const chapterBtn = document.getElementById('currentChapter');
  if (chapterBtn && cur) chapterBtn.textContent = cur.title.length > 30 ? cur.title.slice(0,30)+'...' : cur.title;
}

if (!S._openAccordions) S._openAccordions = new Set();
function toggleAccordion(idx, bookWordIndex) {
  if (S._openAccordions.has(idx)) {
    S._openAccordions.delete(idx);
  } else {
    S._openAccordions.add(idx);
  }
  renderTOC();
}

// Keep old name as alias for compatibility
function renderChapters() { renderTOC(); }

// ── Bookmarks ──────────────────────────────────────────────
let _bookmarksCache = {}; // id -> [{id, idx, label, time}]
async function loadBookmarks(id) {
  if (_bookmarksCache[id]) return _bookmarksCache[id];
  try {
    const res = await fetch('/api/books/' + encodeURIComponent(id) + '/bookmarks');
    if (!res.ok) return [];
    const bms = await res.json();
    _bookmarksCache[id] = bms;
    return bms;
  } catch { return []; }
}
function saveBookmarks(id, bms) {
  // No-op: bookmarks are saved individually via API
}

async function addBookmark() {
  if (!S.currentBook || S.words.length === 0) return;
  const bms = await loadBookmarks(S.currentBook.id);
  if (bms.some(b => b.idx === S.wordIndex)) return;
  const ctx = S.words.slice(Math.max(0, S.wordIndex - 2), S.wordIndex + 4).join(' ');
  const label = ctx.length > 40 ? ctx.slice(0, 40) + '...' : ctx;
  try {
    await fetch('/api/books/' + encodeURIComponent(S.currentBook.id) + '/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idx: S.wordIndex, label })
    });
    delete _bookmarksCache[S.currentBook.id]; // invalidate cache
  } catch(e) { console.warn('addBookmark:', e); }
  await renderBookmarks();
  showToast('Bookmark added');
}

async function deleteBookmark(idx) {
  if (!S.currentBook) return;
  try {
    await fetch('/api/books/' + encodeURIComponent(S.currentBook.id) + '/bookmarks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idx })
    });
    delete _bookmarksCache[S.currentBook.id];
  } catch(e) { console.warn('deleteBookmark:', e); }
  await renderBookmarks();
}

async function renderBookmarks() {
  const el = document.getElementById('bookmarkList');
  if (!el || !S.currentBook) return;
  const bms = await loadBookmarks(S.currentBook.id);
  if (bms.length === 0) {
    el.innerHTML = '<div style="font-size:11px;color:var(--dim);opacity:0.5;padding:4px 0">No bookmarks yet</div>';
    return;
  }
  el.innerHTML = bms.map((bm) => {
    const pct = S.words.length > 0 ? Math.round((bm.idx / S.words.length) * 100) : 0;
    return `<div class="bookmark-item" onclick="jumpTo(${bm.idx})">
      <span class="bm-icon">\u{1F516}</span>
      <span class="bm-label">${esc(bm.label)}</span>
      <span class="bm-pos">${pct}%</span>
      <span class="bm-del" onclick="event.stopPropagation();deleteBookmark(${bm.idx})">\u2715</span>
    </div>`;
  }).join('');
}

function toggleTocSidebar() {
  document.getElementById('tocSidebar').classList.toggle('open');
  document.getElementById('tocOverlay').classList.toggle('open');
}

// ── Minimap ──────────────────────────────────────────────
let _minimapDrawn = false;
let _minimapCanvasH = 0; // actual rendered canvas height in CSS px

function drawMinimap() {
  const canvas = document.getElementById('minimapCanvas');
  const container = document.getElementById('minimap');
  if (!canvas || !container || S.words.length === 0) return;
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;

  const text = S.textCache[S.currentBook?.id] || '';
  if (!text) return;
  const lines = text.split('\n');
  const totalLines = lines.length;
  if (totalLines === 0) return;

  // Scale to fit within browser canvas limits
  const maxCanvasPx = 16000;
  const fontSize = 2;
  const baseLineH = 3;
  let rawH = totalLines * baseLineH;
  let sampleStep = 1;
  if (rawH > maxCanvasPx) {
    sampleStep = Math.ceil(rawH / maxCanvasPx);
    rawH = Math.ceil(totalLines / sampleStep) * baseLineH;
    rawH = Math.min(rawH, maxCanvasPx);
  }
  _minimapCanvasH = rawH;

  canvas.width = w * dpr;
  canvas.height = rawH * dpr;
  canvas.style.height = rawH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, rawH);

  const isDark = S.theme !== 'light';
  const textColor = isDark ? 'rgba(232,228,223,0.45)' : 'rgba(26,26,26,0.35)';
  const headingColor = isDark ? 'rgba(232,228,223,0.8)' : 'rgba(26,26,26,0.7)';
  ctx.font = fontSize + 'px sans-serif';
  ctx.textBaseline = 'top';

  let row = 0;
  for (let i = 0; i < totalLines; i += sampleStep) {
    const line = lines[i].trim();
    if (!line) { row++; continue; }
    const y = row * baseLineH;
    if (y >= rawH) break;
    const isHeading = line.length > 3 && line.length < 80 && line === line.toUpperCase() && /[A-Z]/.test(line);
    ctx.fillStyle = isHeading ? headingColor : textColor;
    ctx.fillText(line.slice(0, 200), 2, y);
    row++;
  }

  canvas.style.opacity = '1';
  _minimapDrawn = true;
  updateMinimapViewport();
}

function updateMinimapViewport() {
  const vp = document.getElementById('minimapViewport');
  const container = document.getElementById('minimap');
  const canvas = document.getElementById('minimapCanvas');
  if (!vp || !container || !canvas || S.words.length === 0) return;

  const containerH = container.getBoundingClientRect().height;
  const canvasH = _minimapCanvasH || containerH;
  const pct = S.wordIndex / S.words.length;

  // Viewport tile height = proportion of container visible vs total doc
  // Like VS Code: tile represents the "window" into the document
  const vpHeight = Math.max(14, Math.min(containerH * 0.15, (containerH / canvasH) * containerH));

  // Tile position in canvas-space, then clamp to canvas bounds
  const tileCanvasTop = pct * (canvasH - vpHeight);

  // Scroll the canvas so the tile stays visible and centered in the container
  let scroll = 0;
  if (canvasH > containerH) {
    // Center the tile in the container
    scroll = tileCanvasTop - (containerH - vpHeight) / 2;
    scroll = Math.max(0, Math.min(scroll, canvasH - containerH));
  }
  canvas.style.top = -scroll + 'px';

  // Tile position in container-space = canvas position minus scroll
  const vpTop = tileCanvasTop - scroll;
  vp.style.top = Math.max(0, Math.min(vpTop, containerH - vpHeight)) + 'px';
  vp.style.height = vpHeight + 'px';
}

// Convert a mouse/touch event to a document percentage (0–1)
function minimapPctFromEvent(e) {
  const container = document.getElementById('minimap');
  const canvas = document.getElementById('minimapCanvas');
  if (!container || !canvas) return null;
  const rect = container.getBoundingClientRect();
  const canvasH = _minimapCanvasH || rect.height;
  // How far the canvas is scrolled
  const scroll = -(parseFloat(canvas.style.top) || 0);
  // Mouse Y relative to container top → convert to canvas-space
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const yInCanvas = (clientY - rect.top) + scroll;
  return Math.max(0, Math.min(1, yInCanvas / canvasH));
}

let _minimapDragging = false;

function _minimapJump(pct) {
  if (pct === null || S.words.length === 0) return;
  S.wordIndex = Math.max(0, Math.min(Math.floor(pct * S.words.length), S.words.length - 1));
  renderWord(S.words[S.wordIndex], S.fontSize);
  updateProgress();
}

// Drag + click support
(function() {
  const mm = document.getElementById('minimap');
  if (!mm) return;

  function onDown(e) {
    if (S.words.length === 0) return;
    _minimapDragging = true;
    e.preventDefault();
    // Click = jump immediately
    _minimapJump(minimapPctFromEvent(e));
  }
  function onMove(e) {
    if (!_minimapDragging || S.words.length === 0) return;
    e.preventDefault();
    _minimapJump(minimapPctFromEvent(e));
  }
  function onUp() {
    if (_minimapDragging && S.currentBook) {
      saveBM(S.currentBook.id, S.wordIndex);
      renderTOC();
    }
    _minimapDragging = false;
  }

  mm.addEventListener('mousedown', onDown);
  mm.addEventListener('touchstart', onDown, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);
})();

function proxyFetch(url) {
  return fetch('/api/proxy?url=' + encodeURIComponent(url));
}
async function fetchGutenbergText(query) {
  try {
    const res = await fetch(`${GUTENBERG_API}?search=${encodeURIComponent(query)}&languages=en`);
    const data = await res.json();
    const book = data.results?.[0];
    if (!book) return null;
    const fmt=book.formats||{};
    const url=fmt['text/plain; charset=utf-8']||fmt['text/plain']||fmt['text/plain; charset=us-ascii']||Object.entries(fmt).find(([k])=>k.startsWith('text/plain'))?.[1];
    if (!url) return null;
    const r=await proxyFetch(url);
    return await r.text();
  } catch(e) { console.error(e); return null; }
}

async function importBook(title, text, source='import') {
  const id='book-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  const wordCount=tokenize(text).length;
  const meta={id,title,wordCount,source,addedAt:new Date().toISOString(),wordIndex:0};
  S.textCache[id]=text; IDB.set(id, text);
  S.library.unshift(meta);
  await saveBook(id, title, wordCount, source, text);
  return meta;
}

// ── File handling ──────────────────────────────────────────
async function handleFile(e) {
  const file=e.target.files?.[0];
  if (!file) return;
  // Warn on large files
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > 500) {
    alert('Files over 500MB are not supported.');
    e.target.value=''; return;
  }
  if (sizeMB > 100) {
    if (!confirm(`This file is ${Math.round(sizeMB)}MB. Very large files may cause performance issues on mobile. Continue?`)) {
      e.target.value=''; return;
    }
  }
  showLoading(`Processing ${file.name}...`);
  try {
    let text='';
    const name=file.name.replace(/\.[^.]+$/,'');
    if (file.name.endsWith('.pdf')) {
      text = await extractPDF(file);
    } else {
      text = await file.text();
    }
    if (text.trim().length<10) { alert('Could not extract text.'); hideLoading(); e.target.value=''; return; }
    const meta=await importBook(name,text);
    if (meta.wordCount > 500000) {
      showToast(`${meta.wordCount.toLocaleString()} words — very long text, may be slow on mobile`);
    }
    renderLibrary();
    await openBook(meta.id);
  } catch(err) { alert('Failed: '+err.message); hideLoading(); }
  e.target.value='';
}

async function extractPDF(file) {
  if (!window.pdfjsLib) {
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload=()=>{ window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(); };
      s.onerror=rej;
      document.head.appendChild(s);
    });
  }
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const parts=[];
  const total=pdf.numPages;
  for (let i=1;i<=total;i++) {
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    let pageText='';
    for (const item of content.items) {
      if (!item.str) continue;
      pageText += item.str;
      if (item.hasEOL) pageText += '\n';
      else pageText += ' ';
    }
    parts.push(pageText);
    page.cleanup();
    if (i%5===0||i===total) {
      showLoading(`Extracting PDF... ${Math.round(i/total*100)}%`, Math.round(i/total*100));
      await new Promise(r=>setTimeout(r,0));
    }
  }
  pdf.destroy();
  let text=parts.join('\n\n');
  text = text
    .replace(/\f/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/([a-z])\n([a-z])/g, '$1 $2');
  return text;
}

function importPaste() {
  const text=document.getElementById('pasteArea').value;
  if (!text.trim()) return;
  if (text.length > 10000000) {
    alert('Pasted text is too large (>10MB). Try importing as a file instead.');
    return;
  }
  const title=prompt('Title:','Pasted Text')||'Pasted Text';
  importBook(title,text).then(meta=>{
    document.getElementById('pasteArea').value='';
    document.getElementById('pasteBtn').style.display='none';
    renderLibrary();
    openBook(meta.id);
  });
}

// ── Gutenberg search ───────────────────────────────────────
async function searchGutenberg(query) {
  query=query||document.getElementById('gutenSearch').value;
  if (!query.trim()) return;
  document.getElementById('gutenSearch').value=query;
  document.getElementById('gutenResults').innerHTML='<div style="text-align:center;padding:40px"><div class="spinner" style="margin:0 auto 12px"></div>Searching...</div>';
  document.getElementById('gutenFeatured').style.display='none';
  try {
    const res=await fetch(`${GUTENBERG_API}?search=${encodeURIComponent(query)}&languages=en`);
    const data=await res.json();
    const books=data.results||[];
    if (books.length===0) {
      document.getElementById('gutenResults').innerHTML='<div class="empty-state">No results. Try a different search.</div>';
      return;
    }
    document.getElementById('gutenResults').innerHTML=books.map((b,i)=>{
      const author=b.authors?.[0]?.name||'Unknown';
      const hasText=Object.keys(b.formats||{}).some(k=>k.startsWith('text/plain'));
      const cover=b.formats?.['image/jpeg']||'';
      return `<div class="guten-card" style="opacity:${hasText?1:0.5}">
        ${cover?`<img src="${esc(cover)}" class="guten-cover">`:''}
        <div style="flex:1;min-width:0">
          <div class="book-title" style="font-size:14px">${esc(b.title)}</div>
          <div class="book-meta">${esc(author)} · ${(b.download_count||0).toLocaleString()} downloads</div>
        </div>
        ${hasText?`<button class="btn-primary" style="padding:8px 14px;font-size:13px;flex-shrink:0" onclick="downloadGuten(${i})">Add</button>`
        :`<span style="font-size:11px;color:var(--dim);flex-shrink:0">No text</span>`}
      </div>`;
    }).join('');
    window._gutenResults=books;
  } catch(e) {
    document.getElementById('gutenResults').innerHTML='<div class="empty-state">Search failed. Check your connection.</div>';
  }
}
window._gutenResults=[];

async function downloadGuten(idx) {
  const book=window._gutenResults[idx];
  if (!book) return;
  showLoading(`Downloading "${book.title}"...`);
  try {
    const fmt=book.formats||{};
    // Prefer proper text files, skip readme/metadata files
    const candidates=Object.entries(fmt).filter(([k,v])=>k.startsWith('text/plain')&&!v.includes('-readme'));
    const url=(candidates.find(([k])=>k==='text/plain; charset=utf-8')||candidates.find(([k])=>k==='text/plain')||candidates.find(([k])=>k==='text/plain; charset=us-ascii')||candidates[0])?.[1];
    if (!url) { alert('No text version available for this edition.'); hideLoading(); return; }
    const res=await proxyFetch(url);
    const text=await res.text();
    const wc=text.split(/\s+/).length;
    if (wc<1000) { hideLoading(); alert(`This edition only has ${wc.toLocaleString()} words — likely an audiobook listing or metadata, not the full text. Try a different edition.`); return; }
    const author=book.authors?.[0]?.name||'Unknown';
    const meta=await importBook(`${book.title} — ${author}`, text, 'gutenberg');
    renderLibrary();
    await openBook(meta.id);
  } catch(e) { alert('Download failed: '+e.message); hideLoading(); }
}

async function downloadFeatured(gutenId, title, author, btn) {
  btn.disabled=true; btn.textContent='...';
  showLoading(`Downloading "${title}"...`);
  try {
    const res=await fetch(`${GUTENBERG_API}/${gutenId}`);
    const book=await res.json();
    const fmt=book.formats||{};
    const candidates=Object.entries(fmt).filter(([k,v])=>k.startsWith('text/plain')&&!v.includes('-readme'));
    const url=(candidates.find(([k])=>k==='text/plain; charset=utf-8')||candidates.find(([k])=>k==='text/plain')||candidates.find(([k])=>k==='text/plain; charset=us-ascii')||candidates[0])?.[1];
    if (!url) { alert('No text version.'); hideLoading(); btn.disabled=false; btn.textContent='Add'; return; }
    const tRes=await proxyFetch(url);
    const text=await tRes.text();
    const wc=text.split(/\s+/).length;
    if (wc<1000) { hideLoading(); alert('This version has too few words. Try searching for it instead.'); btn.disabled=false; btn.textContent='Add'; return; }
    const meta=await importBook(`${title} — ${author}`, text, 'gutenberg');
    renderLibrary();
    btn.textContent='Added';
    await openBook(meta.id);
  } catch(e) { alert('Download failed: '+e.message); btn.disabled=false; btn.textContent='Add'; hideLoading(); }
}

function renderFeatured() {
  const el=document.getElementById('gutenFeatured');
  const fmtDl=n=>n>=1000?(n/1000).toFixed(n>=10000?0:1)+'k':n.toString();
  el.innerHTML=FEATURED_BOOKS.map(section=>{
    const rows=section.books.map(b=>`<div class="featured-row" onclick="downloadFeatured(${b.id},'${b.t.replace(/'/g,"\\'")}','${b.a.replace(/'/g,"\\'")}',this)">
        <span class="fb-dl">${fmtDl(b.dl)}</span>
        <span class="fb-title">${esc(b.t)}</span>
        <span class="fb-author">${esc(b.a)}</span>
      </div>`).join('');
    return `<div class="featured-section"><h3>${esc(section.cat)}</h3><div class="featured-log">${rows}</div></div>`;
  }).join('');
}

// ── TTS (Web Speech API) ────────────────────────────────────
const TTS = {
  enabled: false,
  synth: window.speechSynthesis || null,
  voice: null,
  _queue: [],
  _speaking: false,

  init() {
    if (!this.synth) return;
    const populate = () => {
      const voices = this.synth.getVoices();
      const sel = document.getElementById('ttsVoice');
      if (!sel || voices.length === 0) return;
      sel.innerHTML = voices.map((v, i) =>
        `<option value="${i}"${v.default ? ' selected' : ''}>${v.name} (${v.lang})</option>`
      ).join('');
      // Prefer an English voice
      const eng = voices.findIndex(v => v.lang.startsWith('en') && v.default) ||
                  voices.findIndex(v => v.lang.startsWith('en'));
      if (eng >= 0) { sel.value = eng; this.voice = voices[eng]; }
      else this.voice = voices[0];
      sel.onchange = () => { this.voice = voices[parseInt(sel.value)]; };
    };
    this.synth.onvoiceschanged = populate;
    populate();
    document.getElementById('ttsCheck').addEventListener('change', (e) => {
      this.enabled = e.target.checked;
      const row = document.getElementById('ttsVoiceRow');
      row.style.display = this.enabled ? 'flex' : 'none';
      row.classList.toggle('hidden', !this.enabled);
      if (!this.enabled) this.stop();
    });
  },

  speak(text) {
    if (!this.enabled || !this.synth) return;
    // Batch words into short phrases for natural speech
    this._queue.push(text);
    if (!this._speaking) this._flush();
  },

  speakPhrase(words) {
    if (!this.enabled || !this.synth || words.length === 0) return;
    const utt = new SpeechSynthesisUtterance(words.join(' '));
    if (this.voice) utt.voice = this.voice;
    utt.rate = Math.min(Math.max(S.wpm / 200, 0.5), 4);
    this.synth.speak(utt);
  },

  _flush() {
    if (this._queue.length === 0) { this._speaking = false; return; }
    this._speaking = true;
    const batch = this._queue.splice(0, this._queue.length);
    const utt = new SpeechSynthesisUtterance(batch.join(' '));
    if (this.voice) utt.voice = this.voice;
    utt.rate = Math.min(Math.max(S.wpm / 200, 0.5), 4);
    utt.onend = () => this._flush();
    utt.onerror = () => { this._speaking = false; };
    this.synth.speak(utt);
  },

  stop() {
    this._queue = [];
    this._speaking = false;
    if (this.synth) this.synth.cancel();
  }
};

// ── Playback ───────────────────────────────────────────────
function togglePlay() {
  S.playing=!S.playing;
  updatePlayBtn();
  // Auto-hide controls during playback
  const strip = document.getElementById('controlStrip');
  if (S.playing) {
    strip.classList.add('autohide');
    S.accelMode=document.getElementById('accelCheck').checked;
    S.accelTarget=parseInt(document.getElementById('accelTarget').value)||600;
    saveSettings();
    if (!S.sessionStartTime) S.sessionStartTime = Date.now();
    if (S.accelMode) S.accelStart=Date.now();
    if (TTS.enabled) {
      TTS.stop();
      TTS.speakPhrase(S.words.slice(S.wordIndex, S.wordIndex + 30));
    }
    tick();
  } else {
    strip.classList.remove('autohide');
    clearTimeout(S.timer);
    TTS.stop();
    if (S.sessionWordsRead > 20) {
      const elapsed = (Date.now() - S.sessionStartTime) / 60000;
      const actualWpm = Math.round(S.sessionWordsRead / elapsed);
      const remaining = S.words.length - S.wordIndex;
      const eta = Math.ceil(remaining / actualWpm);
      document.getElementById('wordCount').textContent = `${actualWpm} WPM actual · ~${eta}m left`;
    }
    S.accelStart=null;
  }
}

function tick() {
  if (!S.playing||S.wordIndex>=S.words.length-1) {
    S.playing=false; updatePlayBtn(); return;
  }
  let wpm=S.wpm;
  if (S.accelMode&&S.accelStart) {
    const p=Math.min((Date.now()-S.accelStart)/1000/S.accelDuration,1);
    wpm=S.wpm+(S.accelTarget-S.wpm)*p;
  }
  const w=S.words[S.wordIndex]||'';
  let delay=wordDelay(w, 60000/wpm);

  // Extra pause at digest block boundaries
  if (S.digestMode && S.digestBoundaries) {
    const nextIdx = S.wordIndex + 1;
    const isBlockBoundary = S.digestBoundaries.some(b => b.wordIndex === nextIdx);
    if (isBlockBoundary) {
      delay += 1000;
      // Flash blank briefly at boundary
      setTimeout(() => {
        document.getElementById('wordDisplay').innerHTML = '<span style="opacity:0.15">···</span>';
      }, delay * 0.3);
    }
  }

  S.timer=setTimeout(()=>{
    S.sessionWordsRead++;
    S.wordIndex=Math.min(S.wordIndex+1, S.words.length-1);
    renderWord(S.words[S.wordIndex], S.fontSize);
    updateProgress();
    // Auto-save bookmark every 50 words
    if (S.wordIndex%50===0 && S.currentBook) { saveBM(S.currentBook.id, S.wordIndex); }
    if (S.wordIndex%200===0) renderTOC();
    if (TTS.enabled && S.wordIndex%30===0) TTS.speakPhrase(S.words.slice(S.wordIndex, S.wordIndex+30));
    tick();
  }, delay);
}

function skip(n) {
  S.wordIndex=Math.max(0, Math.min(S.wordIndex+n, S.words.length-1));
  renderWord(S.words[S.wordIndex], S.fontSize);
  updateProgress();
}
function jumpTo(idx) {
  if (S.words.length === 0) return;
  S.wordIndex=Math.max(0, Math.min(idx, S.words.length-1));
  renderWord(S.words[S.wordIndex], S.fontSize);
  updateProgress(); renderTOC();
  // Close mobile sidebar
  document.getElementById('tocSidebar').classList.remove('open');
  document.getElementById('tocOverlay').classList.remove('open');
  // Auto-start playback when jumping from TOC
  if (!S.playing) {
    S.playing = true;
    updatePlayBtn();
    S.accelMode = document.getElementById('accelCheck').checked;
    S.accelTarget = parseInt(document.getElementById('accelTarget').value) || 600;
    if (S.accelMode) S.accelStart = Date.now();
    tick();
  }
}
function seekProgress(e) {
  const rect=e.currentTarget.getBoundingClientRect();
  const x=(e.clientX-rect.left)/rect.width;
  jumpTo(Math.floor(x*S.words.length));
}
function setWpm(v) { S.wpm=parseInt(v); document.getElementById('wpmLabel').textContent=S.wpm; saveSettings(); }
function setFontSize(v) { S.fontSize=parseInt(v); renderWord(S.words[S.wordIndex], S.fontSize); saveSettings(); }


function goToLibrary() {
  S.playing=false; clearTimeout(S.timer); updatePlayBtn(); TTS.stop();
  if (S.currentBook) saveBMNow(S.currentBook.id, S.wordIndex);
  S.currentBook = null; S.lastBook = null; saveSettings();
  S.digestMode = false;
  S.digestBlocks = [];
  S.digestBoundaries = null;
  document.getElementById('blockIndicator').classList.add('hidden');
  document.getElementById('blockLabel').classList.add('hidden');
  document.getElementById('wordDisplay').className = 'word-display';
  document.getElementById('readerView').classList.remove('digest-reading');
  document.getElementById('readerView').classList.remove('active');
  document.getElementById('libraryView').classList.add('active');
  renderLibrary();
  document.title = 'RSVP Reader';
}

async function confirmDelete(id) {
  if (confirm('Delete this book?')) {
    S.library=S.library.filter(b=>b.id!==id);
    delete S.textCache[id]; IDB.del(id);
    delete _bookmarksCache[id];
    try {
      await fetch('/api/books/' + encodeURIComponent(id), { method: 'DELETE' });
    } catch(e) { console.warn('delete failed:', e); }
    renderLibrary();
  }
}

// ── Tabs / Theme ───────────────────────────────────────────
function switchTab(tab) {
  document.getElementById('tabMyBooks').classList.toggle('active', tab==='mybooks');
  document.getElementById('tabFree').classList.toggle('active', tab==='free');
  document.getElementById('tabDigest').classList.toggle('active', tab==='digest');
  document.getElementById('panelMyBooks').classList.toggle('hidden', tab!=='mybooks');
  document.getElementById('panelFree').classList.toggle('hidden', tab!=='free');
  document.getElementById('panelDigest').classList.toggle('hidden', tab!=='digest');
  if (tab==='digest') renderDigestList();
}
function toggleTheme() {
  S.theme=S.theme==='dark'?'light':'dark';
  document.body.classList.toggle('light', S.theme==='light');
  const icon=S.theme==='dark'?'☀':'●';
  document.getElementById('themeFab1').textContent=icon;
  document.getElementById('themeFab2').textContent=icon;
  saveSettings();
}
function setAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  S.accent = color;
  // Update picker dots
  document.querySelectorAll('.accent-dot').forEach(d => {
    d.classList.toggle('active', d.style.background === color || rgb2hex(d.style.backgroundColor) === color.toLowerCase());
  });
  // Update custom color input
  const ci = document.getElementById('accentColorInput');
  if (ci) { ci.value = color; document.getElementById('accentCustom').style.background = color; }
  saveSettings();
}
function rgb2hex(rgb) {
  if (rgb.startsWith('#')) return rgb;
  const m = rgb.match(/(\d+)/g);
  if (!m) return rgb;
  return '#' + m.slice(0,3).map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
}

// ── Keyboard ───────────────────────────────────────────────
document.addEventListener('keydown', e=>{
  if (!document.getElementById('readerView').classList.contains('active')) return;
  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if (e.code==='Space') { e.preventDefault(); togglePlay(); }
  if (e.code==='ArrowLeft') skip(-10);
  if (e.code==='ArrowRight') skip(10);
  if (e.code==='ArrowUp') { S.wpm=Math.min(S.wpm+25,1200); document.getElementById('wpmSlider').value=S.wpm; setWpm(S.wpm); }
  if (e.code==='ArrowDown') { S.wpm=Math.max(S.wpm-25,50); document.getElementById('wpmSlider').value=S.wpm; setWpm(S.wpm); }
  if (e.key==='b'||e.key==='B') addBookmark();
  if (e.key==='[') { S.fontSize=Math.max(28,S.fontSize-4); document.getElementById('fontSlider').value=S.fontSize; setFontSize(S.fontSize); }
  if (e.key===']') { S.fontSize=Math.min(120,S.fontSize+4); document.getElementById('fontSlider').value=S.fontSize; setFontSize(S.fontSize); }
  if (e.code==='Home') { e.preventDefault(); jumpTo(0); }
  if (e.code==='End') { e.preventDefault(); jumpTo(S.words.length-1); }
  if (e.code==='Escape') goToLibrary();
});

// ── Touch & click for word area ─────────────────────────────
let lastTouchEnd = 0;
let _lastTapTime = 0;
document.getElementById('wordArea').addEventListener('click', function(e) {
  // Prevent double-fire from touch+click
  if (Date.now() - lastTouchEnd < 300) return;
  togglePlay();
});

// Swipe support for iPad
let touchStartX = 0, touchStartY = 0;
document.getElementById('wordArea').addEventListener('touchstart', function(e) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.getElementById('wordArea').addEventListener('touchend', function(e) {
  lastTouchEnd = Date.now();
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
    if (dx > 0) skip(-20); else skip(20);
  } else if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 2) {
    const delta = dy < 0 ? 50 : -50;
    S.wpm = Math.max(50, Math.min(1200, S.wpm + delta));
    document.getElementById('wpmSlider').value = S.wpm;
    setWpm(S.wpm);
  } else if (Math.abs(dx) < 15 && Math.abs(dy) < 15) {
    if (Date.now() - _lastTapTime < 300) {
      _lastTapTime = 0;
      addBookmark();
      return;
    }
    _lastTapTime = Date.now();
    togglePlay();
  }
});

// Control buttons
document.getElementById('playBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  togglePlay();
});
document.getElementById('skipBack10').addEventListener('click', ()=>skip(-10));
document.getElementById('skipFwd10').addEventListener('click', ()=>skip(10));
document.getElementById('progressBar').addEventListener('click', seekProgress);
document.getElementById('wpmSlider').addEventListener('input', e=>setWpm(e.target.value));
document.getElementById('fontSlider').addEventListener('input', e=>setFontSize(e.target.value));
// Close settings popover when clicking outside
document.addEventListener('click', e=>{
  const pop=document.getElementById('settingsPopover');
  if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !e.target.closest('[title=Settings]')) pop.classList.add('hidden');
  if (!e.target.closest('.row-menu')) document.querySelectorAll('.row-dropdown.open').forEach(d=>d.classList.remove('open'));
  if (!e.target.closest('.col-tag')) document.querySelectorAll('.tag-picker.open').forEach(p=>p.classList.remove('open'));
});

// ── Paste area toggle ──────────────────────────────────────
document.getElementById('pasteArea').addEventListener('input', e=>{
  document.getElementById('pasteBtn').style.display=e.target.value.trim()?'block':'none';
});

// ── Dev Digest System ───────────────────────────────────────
const DIGEST_SESSIONS = [];
// Load local digests from localStorage first
try {
  const localDigests = JSON.parse(localStorage.getItem('localDigests') || '[]');
  localDigests.forEach(s => DIGEST_SESSIONS.push(s));
} catch {}
// Then load API digests, deduplicating by id
fetch('/api/digests').then(r=>r.ok?r.json():[]).then(sessions=>{
  const existingIds = new Set(DIGEST_SESSIONS.map(s => s.id));
  sessions.forEach(s => { if (!existingIds.has(s.id)) DIGEST_SESSIONS.push(s); });
  if(document.getElementById('tabDigest').classList.contains('active')) renderDigestList();
  // Auto-open digest from ?digest=<id> query param
  checkDigestQueryParam();
}).catch(()=>{});
// Render immediately if local digests were loaded
if (DIGEST_SESSIONS.length && document.getElementById('tabDigest').classList.contains('active')) renderDigestList();

// Check URL for ?digest=<id> and auto-open
function checkDigestQueryParam() {
  const params = new URLSearchParams(window.location.search);
  const digestId = params.get('digest');
  if (!digestId) return;
  const session = DIGEST_SESSIONS.find(s => s.id === digestId);
  if (session) {
    switchTab('digest');
    renderDigestList();
    openDigest(digestId);
    // Clean URL without reloading
    history.replaceState(null, '', window.location.pathname);
  }
}

// Digest state
S.digestMode = false;   // true when RSVP-ing a digest
S.digestBlocks = [];    // current digest blocks
S.digestBlockIdx = 0;   // current block index

const TAG_COLORS = {
  critical: { bg:'#e8404020', fg:'#e84040', border:'#e8404060', label:'CRITICAL' },
  high:     { bg:'#e8840020', fg:'#e88400', border:'#e8840060', label:'HIGH' },
  done:     { bg:'#40b86020', fg:'#40b860', border:'#40b86060', label:'DONE' },
  info:     { bg:'#4088e820', fg:'#4088e8', border:'#4088e860', label:'INFO' },
  decision: { bg:'#a855f720', fg:'#a855f7', border:'#a855f760', label:'DECIDE' },
};

function submitPastedDigest() {
  const raw = document.getElementById('digestPasteText').value.trim();
  if (!raw) { showToast('Paste some dev notes first'); return; }

  // First line is the title, rest are blocks
  const lines = raw.split('\n');
  const title = lines[0].replace(/^#+\s*/, '').trim();
  const body = lines.slice(1).join('\n').trim();

  // Parse paragraphs into blocks
  const TAG_RE = /^(DONE|HIGH|CRITICAL|INFO|DECIDE)[:\s]+/i;
  const paragraphs = body ? body.split(/\n\n+/).map(p => p.trim()).filter(Boolean) : [];
  const blocks = paragraphs.length > 0 ? paragraphs.map(para => {
    const m = para.match(TAG_RE);
    if (m) return { tag: m[1].toLowerCase(), text: para.slice(m[0].length).trim() };
    return { tag: 'info', text: para };
  }) : [{ tag: 'info', text: title }];

  const session = {
    id: 'paste-' + Date.now(),
    title,
    project: 'Dev Notes',
    time: new Date().toISOString(),
    blocks
  };

  // Add locally
  DIGEST_SESSIONS.unshift(session);

  // Try to persist to API (best-effort)
  fetch('/api/digests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session)
  }).catch(() => {});

  // Save to localStorage for persistence without KV
  try {
    const stored = JSON.parse(localStorage.getItem('localDigests') || '[]');
    stored.unshift(session);
    localStorage.setItem('localDigests', JSON.stringify(stored.slice(0, 50)));
  } catch {}

  // Reset form
  document.getElementById('digestPasteText').value = '';
  renderDigestList();
  showToast(`Digest created: ${blocks.length} blocks`);
}

function exportDigest(id) {
  const session = DIGEST_SESSIONS.find(s => s.id === id);
  if (!session) return;
  const d = JSON.stringify(session.blocks);
  const t = session.title.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t} — RSVP</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#121010;color:#e8e0d8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden;user-select:none}
.bar{padding:10px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #3a3530;font-size:14px}
.bar .title{font-weight:600;opacity:0.7}
.tag-ind{font-size:11px;font-weight:600}
.word-area{flex:1;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;padding:40px 24px}
.word{font-family:Georgia,'Times New Roman',serif;font-size:64px;letter-spacing:0.02em;white-space:nowrap}
.word .o{color:#e84040;font-weight:700}
.label{position:absolute;bottom:20px;left:16px;right:16px;text-align:center;font-size:12px;color:#8a8078;opacity:0.5}
.strip{padding:12px 16px 20px;display:flex;align-items:center;justify-content:center;gap:12px}
.strip button{background:#1e1b18;border:1px solid #3a3530;color:#e8e0d8;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer}
.strip button:hover{border-color:#e84040}
.strip .play{padding:8px 20px;font-size:16px}
.wpm-row{display:flex;align-items:center;gap:6px;font-size:11px;color:#8a8078}
.wpm-row input{width:70px;accent-color:#e84040;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:#e8e0d8;opacity:0.1;outline:none}
.wpm-row input::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#e84040;cursor:pointer}
.info{font-size:11px;color:#8a8078;text-align:center;padding:4px}
.tc{color:#e84040}.th{color:#e88400}.td{color:#40b860}.ti{color:#4088e8}.tD{color:#a855f7}
</style></head><body>
<div class="bar"><span class="title">${t}</span><span class="tag-ind" id="ti"></span></div>
<div class="word-area" id="wa" onclick="toggle()"><div class="word" id="w"></div><div class="label" id="lb"></div></div>
<div class="info" id="inf"></div>
<div class="strip">
<button onclick="skip(-10)">◁</button>
<button class="play" id="pb" onclick="toggle()">▶</button>
<button onclick="skip(10)">▷</button>
<div class="wpm-row"><span id="wl">300</span><input type="range" min="50" max="1200" step="10" value="300" oninput="wpm=+this.value;document.getElementById('wl').textContent=wpm"></div>
</div>
<script>
const blocks=${d};
const TC={critical:'tc',high:'th',done:'td',info:'ti',decision:'tD'};
const TL={critical:'CRITICAL',high:'HIGH',done:'DONE',info:'INFO',decision:'DECIDE'};
const words=[],bounds=[];
blocks.forEach((b,i)=>{bounds.push({wi:words.length,tag:b.tag,i:i,text:b.text});b.text.split(/\\s+/).filter(w=>w.length>0&&/[a-zA-Z0-9]/.test(w)).forEach(w=>words.push(w))});
let idx=0,playing=false,wpm=300,timer=null;
function orp(w){const c=w.replace(/[^a-zA-Z0-9]/g,''),len=c.length;if(len<=1)return 0;if(len<=5)return 1;if(len<=9)return 2;if(len<=13)return 3;return 4}
function render(){const w=words[idx]||'';const el=document.getElementById('w');const o=orp(w);let cc=0,b='',m='',a='';for(let i=0;i<w.length;i++){const ch=w[i],isA=/[a-zA-Z0-9]/.test(ch);if(isA){if(cc<o)b+=ch;else if(cc===o)m+=ch;else a+=ch;cc++}else{if(cc<=o)b+=ch;else a+=ch}}el.innerHTML=b+'<span class="o">'+m+'</span>'+a;
let cur=bounds[0];for(const bd of bounds){if(idx>=bd.wi)cur=bd;else break}
document.getElementById('ti').className='tag-ind '+(TC[cur.tag]||'ti');document.getElementById('ti').textContent=TL[cur.tag]+' · '+(cur.i+1)+'/'+blocks.length;
document.getElementById('lb').textContent=cur.text.length>80?cur.text.slice(0,80)+'…':cur.text;
const left=Math.ceil((words.length-idx)/(wpm/60));document.getElementById('inf').textContent=idx+' / '+words.length+' · '+(left>60?Math.ceil(left/60)+'m':left+'s')}
function tick(){if(!playing||idx>=words.length-1){playing=false;document.getElementById('pb').textContent='▶';return}
const w=words[idx]||'';let d=60000/wpm;if(/[.!?]$/.test(w))d*=1.8;else if(/[,;:]$/.test(w))d*=1.3;
const ni=idx+1;const isBound=bounds.some(b=>b.wi===ni);if(isBound)d+=1000;
timer=setTimeout(()=>{idx=Math.min(idx+1,words.length-1);render();tick()},d)}
function toggle(){playing=!playing;document.getElementById('pb').textContent=playing?'❚❚':'▶';if(playing)tick();else clearTimeout(timer)}
function skip(n){idx=Math.max(0,Math.min(idx+n,words.length-1));render()}
document.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();toggle()}if(e.code==='ArrowRight')skip(10);if(e.code==='ArrowLeft')skip(-10);if(e.code==='ArrowUp'){wpm=Math.min(wpm+25,1200);document.querySelector('input[type=range]').value=wpm;document.getElementById('wl').textContent=wpm}if(e.code==='ArrowDown'){wpm=Math.max(wpm-25,50);document.querySelector('input[type=range]').value=wpm;document.getElementById('wl').textContent=wpm}});
render();
<\/script></body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (session.title.replace(/[^a-zA-Z0-9\s-]/g,'').trim().replace(/\s+/g,'-').toLowerCase() || 'digest') + '-rsvp.html';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported standalone RSVP file');
}

function renderDigestList() {
  const el = document.getElementById('digestList');
  el.innerHTML = DIGEST_SESSIONS.map((session, si) => {
    const tagCounts = {};
    session.blocks.forEach(b => { tagCounts[b.tag] = (tagCounts[b.tag]||0) + 1; });
    const tags = Object.entries(tagCounts).map(([tag, count]) => {
      const c = TAG_COLORS[tag] || TAG_COLORS.info;
      return `<span class="digest-tag" style="background:${c.bg};color:${c.fg};border:1px solid ${c.border}">${c.label} ×${count}</span>`;
    }).join('');
    const timeStr = new Date(session.time).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });

    const blockListHtml = session.blocks.map((b,bi) => {
      const c = TAG_COLORS[b.tag] || TAG_COLORS.info;
      return `<div style="padding:8px 12px;font-size:13px;line-height:1.5;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:flex-start">
        <span style="color:${c.fg};font-weight:700;font-size:10px;min-width:52px;padding-top:2px">${c.label}</span>
        <span style="color:var(--text);opacity:0.85">${esc(b.text)}</span>
      </div>`;
    }).join('');

    return `<div style="margin-bottom:16px">
      <button class="digest-card" type="button" data-digestid="${session.id}">
        <div class="digest-header">
          <span class="digest-title">${esc(session.title)}</span>
          <span style="display:flex;align-items:center;gap:6px">
            <span class="digest-export" title="Export standalone RSVP" onclick="event.stopPropagation();exportDigest('${session.id}')">↗</span>
            <span class="digest-time">${timeStr}</span>
          </span>
        </div>
        <div style="font-size:11px;color:var(--dim);margin-bottom:6px;opacity:0.7">${esc(session.project)}</div>
        <div class="digest-stats">${tags}</div>
        <div class="digest-summary">${esc(session.blocks[0].text)}</div>
        <div class="digest-block-count">${session.blocks.length} blocks · tap to RSVP</div>
      </button>
      <details style="margin-top:4px">
        <summary style="font-size:12px;color:var(--dim);cursor:pointer;padding:6px 0">View all blocks</summary>
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface)">${blockListHtml}</div>
      </details>
    </div>`;
  }).join('');

  el.querySelectorAll('.digest-card').forEach(card => {
    card.addEventListener('click', function() {
      openDigest(this.dataset.digestid);
    });
  });
}

function openDigest(id) {
  const session = DIGEST_SESSIONS.find(s => s.id === id);
  if (!session) return;

  // Convert digest blocks into word arrays with metadata
  S.digestMode = true;
  S.digestBlocks = session.blocks;
  S.digestBlockIdx = 0;
  S.currentBook = { id, title: session.title };

  // Flatten all blocks into words with block boundary markers
  const allWords = [];
  const blockBoundaries = []; // [{wordIndex, tag, blockIdx, text}]
  session.blocks.forEach((block, bi) => {
    blockBoundaries.push({ wordIndex: allWords.length, tag: block.tag, blockIdx: bi, text: block.text });
    const words = tokenize(block.text);
    words.forEach(w => allWords.push(w));
  });

  S.words = allWords;
  S.digestBoundaries = blockBoundaries;
  S.wordIndex = 0;
  S.playing = false;
  S.chapters = blockBoundaries.map((b,i) => ({
    title: `${TAG_COLORS[b.tag].label}: ${b.text.slice(0,50)}...`,
    index: b.wordIndex
  }));

  S.sessionWordsRead = 0;
  S.sessionStartTime = null;

  // Switch to reader
  document.getElementById('libraryView').classList.remove('active');
  document.getElementById('readerView').classList.add('active');
  document.getElementById('readerView').classList.add('digest-reading');
  document.getElementById('readerBookTitle').textContent = session.title;

  cacheWordArea();
  updateDigestIndicator();
  renderWord(S.words[0], S.fontSize);
  updateProgress(); updatePlayBtn();

  // TOC sidebar
  renderTOC();
  drawMinimap();
  renderBookmarks();
}

function getCurrentDigestBlock() {
  if (!S.digestMode || !S.digestBoundaries) return null;
  let current = S.digestBoundaries[0];
  for (const b of S.digestBoundaries) {
    if (S.wordIndex >= b.wordIndex) current = b;
    else break;
  }
  return current;
}

function updateDigestIndicator() {
  const indicator = document.getElementById('blockIndicator');
  const label = document.getElementById('blockLabel');
  if (!S.digestMode) {
    indicator.classList.add('hidden');
    label.classList.add('hidden');
    return;
  }
  const block = getCurrentDigestBlock();
  if (!block) return;
  const c = TAG_COLORS[block.tag] || TAG_COLORS.info;
  indicator.classList.remove('hidden');
  indicator.style.color = c.fg;
  indicator.textContent = `${c.label} · ${block.blockIdx+1}/${S.digestBlocks.length}`;

  label.classList.remove('hidden');
  label.textContent = block.text.length > 80 ? block.text.slice(0,80)+'…' : block.text;

  // Tint the ORP color based on tag
  const wordEl = document.getElementById('wordDisplay');
  wordEl.className = 'word-display tag-' + block.tag;
}

let GENERATIVE_ENERGY_TEXT = null;
async function loadGenerativeEnergy() {
  if (GENERATIVE_ENERGY_TEXT) return GENERATIVE_ENERGY_TEXT;
  try {
    const res = await fetch('/generative-energy.txt');
    GENERATIVE_ENERGY_TEXT = await res.text();
  } catch { GENERATIVE_ENERGY_TEXT = ''; }
  return GENERATIVE_ENERGY_TEXT;
}

let THE_VERDICT_TEXT = null;
async function loadTheVerdict() {
  if (THE_VERDICT_TEXT) return THE_VERDICT_TEXT;
  try {
    const res = await fetch('/the-verdict.txt');
    THE_VERDICT_TEXT = await res.text();
  } catch { THE_VERDICT_TEXT = ''; }
  return THE_VERDICT_TEXT;
}

let FIFTH_HEAD_TEXT = null;
async function loadFifthHead() {
  if (FIFTH_HEAD_TEXT) return FIFTH_HEAD_TEXT;
  try {
    const res = await fetch('/fifth-head-of-cerberus.txt');
    if (!res.ok) return '';
    FIFTH_HEAD_TEXT = await res.text();
  } catch { FIFTH_HEAD_TEXT = ''; }
  return FIFTH_HEAD_TEXT;
}

let NABRE_TEXT = null;
async function loadNabre() {
  if (NABRE_TEXT) return NABRE_TEXT;
  try {
    const res = await fetch('/nabre.txt');
    if (!res.ok) return '';
    NABRE_TEXT = await res.text();
  } catch { NABRE_TEXT = ''; }
  return NABRE_TEXT;
}

// ── Init ───────────────────────────────────────────────────

// ── localStorage Migration (one-time) ──────────────────────
async function migrateFromLocalStorage() {
  try {
    const localLib = localStorage.getItem('rsvp-lib');
    if (!localLib) return;
    const books = JSON.parse(localLib);
    if (!Array.isArray(books) || books.length === 0) return;
    showLoading('Migrating books to database...');
    for (const meta of books) {
      const text = localStorage.getItem('rsvp-t-' + meta.id);
      if (!text) continue;
      await saveBook(meta.id, meta.title, meta.wordCount || 0, meta.source || 'import', text);
      const pos = parseInt(localStorage.getItem('rsvp-bm-' + meta.id)) || 0;
      if (pos > 0) {
        await fetch('/api/books/' + encodeURIComponent(meta.id) + '/position', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wordIndex: pos })
        });
      }
      const bmsRaw = localStorage.getItem('rsvp-bms-' + meta.id);
      if (bmsRaw) {
        try {
          const bms = JSON.parse(bmsRaw);
          for (const bm of bms) {
            await fetch('/api/books/' + encodeURIComponent(meta.id) + '/bookmarks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idx: bm.idx, label: bm.label })
            });
          }
        } catch {}
      }
    }
    localStorage.removeItem('rsvp-lib');
    for (const meta of books) {
      localStorage.removeItem('rsvp-t-' + meta.id);
      localStorage.removeItem('rsvp-bm-' + meta.id);
      localStorage.removeItem('rsvp-bms-' + meta.id);
    }
    hideLoading();
  } catch(e) {
    console.warn('Migration error (non-fatal):', e);
    try { hideLoading(); } catch {}
  }
}
(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  TTS.init();
  loadSettings();
  document.getElementById('wpmSlider').value = S.wpm;
  document.getElementById('wpmLabel').textContent = S.wpm;
  document.getElementById('fontSlider').value = S.fontSize;
  if (S.theme === 'light') document.body.classList.add('light');
  if (S.accent) setAccent(S.accent);
  document.getElementById('accelTarget').value = S.accelTarget;
  // Render featured books
  renderFeatured();

  // Migrate from localStorage if needed (one-time)
  await migrateFromLocalStorage();

  // Load library
  S.library=await loadLib();

  // Seed Generative Energy if not already in library
  if (!S.library.some(b => b.title === 'Generative Energy — Raymond Peat')) {
    const geText = await loadGenerativeEnergy();
    const geId = 'book-generative-energy-peat';
    const geWordCount = tokenize(geText).length;
    const geMeta = {id: geId, title: 'Generative Energy — Raymond Peat', wordCount: geWordCount, source: 'bundled', addedAt: new Date().toISOString(), wordIndex: 0};
    S.textCache[geId] = geText;
    S.library.unshift(geMeta);
    await saveBook(geId, geMeta.title, geWordCount, 'bundled', geText);
  }

  // Seed The Verdict if not already in library
  if (!S.library.some(b => b.title === 'The Verdict: This is a Beast')) {
    const tvText = await loadTheVerdict();
    const tvId = 'book-the-verdict-codebase-audit';
    const tvWordCount = tokenize(tvText).length;
    const tvMeta = {id: tvId, title: 'The Verdict: This is a Beast', wordCount: tvWordCount, source: 'bundled', addedAt: new Date().toISOString(), wordIndex: 0};
    S.textCache[tvId] = tvText;
    S.library.unshift(tvMeta);
    await saveBook(tvId, tvMeta.title, tvWordCount, 'bundled', tvText);
  }

  // Seed NABRE Bible if not already in library (background, non-blocking)
  if (!S.library.some(b => b.id === 'book-nabre-bible')) {
    loadNabre().then(async nabreText => {
      if (!nabreText) return;
      try {
        const nabreId = 'book-nabre-bible';
        const words = await tokenizeAsync(nabreText);
        const nabreMeta = {id: nabreId, title: 'NABRE Bible', wordCount: words.length, source: 'bundled', addedAt: new Date().toISOString(), wordIndex: 0};
        S.textCache[nabreId] = nabreText;
        S.library.unshift(nabreMeta);
        await saveBook(nabreId, nabreMeta.title, words.length, 'bundled', nabreText);
        renderLibrary();
        showToast('NABRE Bible added to library');
      } catch(e) { console.warn('NABRE seed error:', e); }
    });
  }

  // Seed The Fifth Head of Cerberus if not already in library (background, non-blocking)
  if (!S.library.some(b => b.id === 'book-fifth-head-cerberus')) {
    loadFifthHead().then(async fhText => {
      if (!fhText) return;
      try {
        const fhId = 'book-fifth-head-cerberus';
        const words = await tokenizeAsync(fhText);
        const fhMeta = {id: fhId, title: 'The Fifth Head of Cerberus — Gene Wolfe', wordCount: words.length, source: 'bundled', addedAt: new Date().toISOString(), wordIndex: 0};
        S.textCache[fhId] = fhText;
        S.library.unshift(fhMeta);
        await saveBook(fhId, fhMeta.title, words.length, 'bundled', fhText);
        renderLibrary();
        showToast('The Fifth Head of Cerberus added to library');
      } catch(e) { console.warn('Fifth Head seed error:', e); }
    });
  }
  renderLibrary();

  // Resume last book if set
  if (S.lastBook && S.library.some(b => b.id === S.lastBook)) {
    await openBook(S.lastBook);
  }

  // Auto-add Moby Dick to library if empty (but don't auto-open it)
  if (S.library.length===0) {
    showLoading('Fetching Moby Dick from Project Gutenberg...');
    try {
      const text = await fetchGutenbergText('moby dick');
      if (text) {
        await importBook('Moby Dick — Herman Melville', text, 'gutenberg');
        renderLibrary();
      }
    } catch(e) {
      console.error('Auto-load error:', e);
    }
    hideLoading();
  }
})();
