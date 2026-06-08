# RSVP social campaign poster

Post screen-recorded RSVP readouts to social platforms from the CLI. No dependencies, Node 18+.

## Make the video

1. Open the homepage. The hero has a live RSVP demo with Restart and a speed control (300 / 500 / 800 WPM). That card is the capture surface. Or open any book and full-screen the reader.
2. Screen-record it: macOS `Cmd+Shift+5`, Windows `Win+G` (Game Bar) or OBS, Linux OBS / `wf-recorder`. Aim for a 9:16 crop for Shorts / Reels / TikTok.
3. Save as `.mp4`. Keep any audio baked into the file (Instagram and TikTok do not let you attach their music library via API).

## Configure

```bash
cp social/.env.example social/.env.local   # gitignored
# fill in keys (Postiz and/or the direct CLIs you want)
```

## Post

```bash
# dry run first (prints the plan, posts nothing)
node social/post.mjs --video out.mp4 --caption "Read at 600 wpm. Open source." \
  --platforms x,bluesky,youtube,mastodon --dry-run

# fan out via a self-hosted Postiz instance (default backend)
node social/post.mjs --video out.mp4 --caption "..." --platforms x,bluesky,youtube,mastodon,linkedin

# or skip Postiz and call per-platform CLIs directly
node social/post.mjs --video out.mp4 --caption "..." --platforms bluesky,mastodon,youtube --direct

# schedule instead of posting now
node social/post.mjs --video out.mp4 --caption "..." --platforms bluesky --schedule 2026-06-10T14:00:00Z

# list connected Postiz integrations
node social/post.mjs --list
```

## Backends

- **Postiz** (recommended, default): self-host the open-source [Postiz](https://github.com/gitroomhq/postiz-app) (`docker compose up -d`), connect accounts once in its UI, and this script fans one video out to all of them. Free software; you still pay each platform's own API costs.
- **`--direct`**: calls per-platform CLIs you install yourself, no aggregator:
  - Bluesky: [`skeet`](https://github.com/sharunkumar/skeet) (`cargo install skeet`), free.
  - Mastodon: [`toot`](https://github.com/ihabunek/toot) (`toot login` once), free.
  - YouTube: [`youtubeuploader`](https://github.com/porjo/youtubeuploader), free (YouTube Data API quota).

## Platform notes (2026)

- **X/Twitter:** no free API tier anymore (pay-per-use, a few cents per post; +$0.20 if the post body contains a URL). Put the GitHub link in your bio or a pinned reply, not the caption. Post via Postiz or manually.
- **TikTok / Instagram:** require an audited app or a Business/Creator account. Unaudited, the API can only drop the video into your inbox as a draft that you publish from the phone.

## Caption ideas

See the campaign captions in the project notes, e.g. "POV: you just read this whole sentence without moving your eyes. That is RSVP. Free, no signup. #speedreading #productivity".

Secrets live only in `social/.env.local` (gitignored). The script never prints them and fails loudly if one is missing.
