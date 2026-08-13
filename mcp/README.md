# @focal/mcp

Give your agent somewhere to put long output.

Agents write more prose than anything else on a developer's machine, and most of it
lands in a terminal scrollback nobody reads. This MCP server hands that text to
[Focal](https://focal.wiki), a speed reader, and gives you back a link. The agent
stops dumping walls of text into the chat. You read them at whatever pace you like.

Zero dependencies. Runs on your machine. Nothing is uploaded.

## Install

```json
{
  "mcpServers": {
    "focal": {
      "command": "npx",
      "args": ["-y", "@focal/mcp"]
    }
  }
}
```

Drop that into your MCP host's config: Claude Code (`~/.claude/settings.json`),
Claude Desktop, Cursor, Windsurf, Zed, or anything else that speaks MCP. No API key,
no account, no signup.

## Tools

**`focal_open`** takes text and returns a link, opening it in your browser by default.

```
focal_open({ text: "...", title: "Refactor plan", wpm: 500 })
-> Opened in Focal, 2,140 words, "Refactor plan"
   https://focal.wiki/#t=7Z1Nb9s4EIb...
```

**`focal_read_url`** fetches a public document, strips the navigation and page
furniture, and returns the readable text. It defaults to returning only the title,
word count, and a Focal link, because usually the point is for *you* to read it, not
for the agent to burn its context window on it. Pass `include_text: true` when the
agent genuinely needs the prose.

Sources served: arXiv, bioRxiv, medRxiv, PubMed Central, Wikipedia (all languages),
Project Gutenberg, Standard Ebooks.

## Where the text goes

Nowhere. `focal_open` compresses your text and puts it in the URL fragment, the part
after the `#`. Browsers never transmit a fragment to a server, so the text travels
from this process to your browser tab and stops. The reader stores it in your
browser's own IndexedDB and nowhere else.

`focal_read_url` fetches public documents through focal.wiki, which stores nothing
and requires no credentials. Only the URL you name is fetched, and only from the
allowlisted sources above.

If you would rather not touch the hosted instance at all, point the server at your
own: set `FOCAL_ORIGIN=https://your-instance`.

## Limits

Text longer than roughly 180KB compressed will not fit in a link, and `focal_open`
will say so rather than producing something broken. Split it, or pass a URL to
`focal_read_url`.

## Source

[github.com/ryan-organically/RSVP](https://github.com/ryan-organically/RSVP), MIT
licensed. The reader is a local-first, no-account, no-tracking web app that works
offline.
