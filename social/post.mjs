#!/usr/bin/env node
/**
 * RSVP Reader social campaign poster.
 *
 * Posts a screen-recorded RSVP video + caption to multiple platforms.
 * Two backends:
 *   default      fan out through a self-hosted Postiz instance (one call, many platforms)
 *   --direct     skip Postiz and call per-platform CLIs (skeet, toot, youtubeuploader)
 *
 * No dependencies. Node 18+. Reads keys from env or social/.env.local (never committed).
 * Nothing secret is ever printed.
 *
 * Usage:
 *   node social/post.mjs --video out.mp4 --caption "Read at 600 wpm." \
 *     --platforms x,bluesky,youtube,mastodon [--schedule 2026-06-10T14:00:00Z] [--dry-run] [--direct]
 *   node social/post.mjs --list          # list connected Postiz integrations
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- env: process.env wins, else parse social/.env.local or repo .env.local ----
function loadEnv() {
  for (const p of [join(HERE, '.env.local'), join(HERE, '..', '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

// ---- args ----
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def; }
const flags = {
  video: arg('video'), caption: arg('caption'), schedule: arg('schedule'),
  platforms: String(arg('platforms', 'x,bluesky,mastodon')).split(',').map(s => s.trim()).filter(Boolean),
  dryRun: !!arg('dry-run', false), direct: !!arg('direct', false), list: !!arg('list', false),
};
function die(msg) { console.error('error: ' + msg); process.exit(1); }
function need(k) { if (!process.env[k]) die('missing env ' + k + ' (set it in social/.env.local, see social/.env.example)'); return process.env[k]; }

// =====================================================================
// Postiz backend (self-hosted aggregator) — see https://github.com/gitroomhq/postiz-app
// =====================================================================
async function postizApi(path, opts = {}) {
  const url = need('POSTIZ_API_URL').replace(/\/$/, '') + path;
  const res = await fetch(url, { ...opts, headers: { Authorization: process.env.POSTIZ_API_KEY, ...(opts.headers || {}) } });
  if (!res.ok) die('Postiz ' + path + ' -> HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}
async function listIntegrations() {
  need('POSTIZ_API_URL'); need('POSTIZ_API_KEY');
  const list = await postizApi('/public/v1/integrations');
  const rows = Array.isArray(list) ? list : (list.integrations || []);
  console.log('Connected Postiz integrations:');
  for (const i of rows) console.log('  ' + (i.identifier || i.providerIdentifier || i.platform || '?').padEnd(12) + ' id=' + (i.id || i._id));
  return rows;
}
async function postViaPostiz() {
  need('POSTIZ_API_URL'); need('POSTIZ_API_KEY');
  if (!flags.video || !existsSync(flags.video)) die('--video file not found: ' + flags.video);
  if (!flags.caption || flags.caption === true) die('--caption is required');

  // 1. map requested platforms -> integration ids
  const integrations = (await postizApi('/public/v1/integrations'));
  const rows = Array.isArray(integrations) ? integrations : (integrations.integrations || []);
  const want = new Set(flags.platforms.map(p => p.toLowerCase()));
  const chosen = rows.filter(i => want.has(String(i.identifier || i.providerIdentifier || i.platform || '').toLowerCase()));
  if (!chosen.length) die('no connected Postiz integrations match: ' + flags.platforms.join(',') + ' (run --list)');

  // 2. upload the video
  const buf = readFileSync(flags.video);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), basename(flags.video));
  const up = await postizApi('/public/v1/upload', { method: 'POST', body: fd });
  const mediaId = up.id || up._id || (up.media && up.media.id) || up.path || up.url;
  if (!mediaId) die('Postiz upload returned no media id (response shape changed; inspect /public/v1/upload)');

  // 3. create the post
  const payload = {
    type: flags.schedule && flags.schedule !== true ? 'schedule' : 'now',
    date: flags.schedule && flags.schedule !== true ? flags.schedule : new Date().toISOString(),
    posts: chosen.map(i => ({
      integration: { id: i.id || i._id },
      value: [{ content: flags.caption, image: [{ id: mediaId }] }],
    })),
  };
  if (flags.dryRun) { console.log('[dry-run] Postiz payload:\n' + JSON.stringify(payload, null, 2)); return; }
  const out = await postizApi('/public/v1/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  console.log('posted via Postiz to: ' + chosen.map(c => c.identifier || c.platform).join(', '));
  console.log(JSON.stringify(out, null, 2));
}

// =====================================================================
// Direct per-platform CLIs (zero-cost, well-supported)
// =====================================================================
function run(cmd, args, env) {
  console.log('  $ ' + cmd + ' ' + args.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' '));
  if (flags.dryRun) return;
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.error) console.error('  (skipped: ' + cmd + ' not installed)');
  else if (r.status !== 0) console.error('  (' + cmd + ' exited ' + r.status + ')');
}
function postDirect() {
  if (!flags.video || !existsSync(flags.video)) die('--video file not found: ' + flags.video);
  if (!flags.caption || flags.caption === true) die('--caption is required');
  for (const p of flags.platforms) {
    console.log('\n-> ' + p);
    switch (p.toLowerCase()) {
      case 'bluesky': case 'bsky':
        run('skeet', [flags.caption, '-i', flags.video], {
          SKEET_HOST: process.env.BSKY_HOST || 'https://bsky.social',
          SKEET_USERNAME: need('BSKY_HANDLE'), SKEET_PASSWORD: need('BSKY_APP_PASSWORD'),
        });
        break;
      case 'mastodon':
        run('toot', ['post', '-m', flags.video, flags.caption]); // toot uses its own ~/.config/toot auth
        break;
      case 'youtube': case 'yt':
        run('youtubeuploader', ['-filename', flags.video, '-title', flags.caption.slice(0, 95), '-description', flags.caption]);
        break;
      case 'x': case 'twitter':
        console.error('  X has no free CLI in 2026 (pay-per-use API). Use Postiz, or post manually. Keep URLs out of the body to avoid the $0.20 URL surcharge.');
        break;
      case 'tiktok': case 'instagram':
        console.error('  ' + p + ' needs an audited app / business account. Use Postiz (uploads as a draft), then publish from the phone.');
        break;
      default: console.error('  unknown platform: ' + p);
    }
  }
}

// ---- main ----
(async () => {
  if (flags.list) return void (await listIntegrations());
  console.log('RSVP campaign poster' + (flags.dryRun ? ' [dry-run]' : '') + (flags.direct ? ' [direct]' : ' [postiz]'));
  console.log('  video:    ' + flags.video);
  console.log('  caption:  ' + flags.caption);
  console.log('  platforms:' + flags.platforms.join(', '));
  if (flags.schedule && flags.schedule !== true) console.log('  schedule: ' + flags.schedule);
  if (flags.direct) postDirect(); else await postViaPostiz();
})().catch(e => die(e.message));
