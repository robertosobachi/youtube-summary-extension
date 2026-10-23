# YouTube Summary

Summarise YouTube videos with Claude, from YouTube itself.

## What it does

- **Watch page:** adds a Summarise button to the video's action row. The summary opens in a drawer on the right.
- **Home tiles:** adds a Summarise button over the top-left corner of each video thumbnail on the Home feed. Shorts are skipped.
- **Summaries:** built from the video's YouTube transcript. Videos without a transcript show a message instead. Each summary has a title, 2-3 sentence summary, main points and a key takeaway, 250 words maximum.
- **Language:** a transcript in one of your configured languages is summarised in that language, any other in English.
- **Cache:** summaries are saved locally, so opening the same video again doesn't call the API. When storage is full the oldest summaries are dropped.
- **Copy for chat:** copies the title, link, summary and full transcript as a ready-made prompt to paste into any chat.
- **Not interested:** in the drawer for a Home tile, sends YouTube's own Not interested command for that video and shows YouTube's response status. The video is also recorded locally.
- **Watched:** a second button on each Home tile, below Summarise. One click sends Not interested, then YouTube's "I've already watched this video" reason, with no summary and no API call. The button shows the result: Done, or where the reason step stopped when only Not interested went through. The reason is matched by its English label, so with YouTube in another language only Not interested is sent.
- **Cancel:** closing the drawer while a summary is in progress cancels it, and nothing is saved.

## Install

Requires Chrome 120 or later.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and select the `dist/` folder.

## Setup

With no API key saved, the settings open in the drawer on YouTube: once when the page loads, and again whenever you click Summarise. You can also open the extension's options page (Details > Extension options on `chrome://extensions`). Fill in:

- **Anthropic API key:** create one in the Claude Console at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). Leave the field empty later to keep the saved key.
- **Summary languages:** comma-separated language codes, for example `en, it`. Defaults to `en`.

Click Save. Test key checks the key against the API without generating a summary.

## Privacy and permissions

**Storage**

- The API key, language list, cached summaries (title, channel, summary, transcript) and your Not interested videos are kept in `chrome.storage.local`, in this browser only.
- Storage is restricted to the extension's own pages and service worker. Content scripts on youtube.com can't read it.
- Only the service worker reads the key. The options page sees whether a key is saved and its last 4 characters. Content scripts only learn whether a key is saved.
- In the YouTube drawer, the settings are the options page in a frame. It runs in the extension's own process, so YouTube's scripts can't read the key as you type it.

**What goes to api.anthropic.com**

- On Summarise, when no cached summary exists: the video title, channel name, language instruction and transcript, with your API key. Model: `claude-sonnet-5-5`. Usage is billed to your Anthropic account.
- On Test key: a request for the model's details, authenticated with your key.

**What goes to youtube.com**

- The transcript request and, when a title isn't already known, an oEmbed lookup for title and channel. Both are same-origin requests from the YouTube page.
- The Not interested command, sent through YouTube's own page code when you click Not interested or Watched. For Watched, also the "I've already watched this video" reason from YouTube's response to it.

The extension makes no other network requests.

**Permissions**

- `storage`: settings, cached summaries and Not interested videos.
- `https://www.youtube.com/*`: the site the content scripts run on.
- `https://api.anthropic.com/*`: lets the service worker call the Claude API.
- `options.html` is web-accessible on youtube.com, so it can be framed in the drawer.

## Development

```sh
npm run build         # bundle src/ with esbuild into dist/ and copy manifest, options page and icons
npm test              # run the Vitest suite once
npm run typecheck     # type-check with tsc, no output
npm run lint          # ESLint
npm run lint:fix      # ESLint with autofix
npm run format        # Prettier, write
npm run format:check  # Prettier, check only
npm run icons         # re-render icons/*.png from the SVGs; only needed after editing them
```

`npm ci` also installs a Husky pre-commit hook that runs lint-staged (Prettier and ESLint on staged files).

```sh
node scripts/sanitise-fixtures.mjs
```

Builds the committed test fixtures in `fixtures/` from private YouTube captures in `fixtures/raw/` (git-ignored). It keeps only the JSON structure the code reads, replaces text, ids and tracking values with fakes, and refuses to write anything if a raw string longer than 6 characters survives.

## Project layout

- `src/background.ts`: service worker. Owns storage, the API key and Claude calls; handles messages from the other contexts.
- `src/claude.ts`: Claude API request, headers, prompt and streamed response parsing.
- `src/content.ts`: content script. Places the Summarise buttons, runs the drawer, fetches transcripts and handles Not interested.
- `src/page.ts`: main-world script. Reads YouTube's page data (Home tiles, config) and sends YouTube's Not interested command.
- `src/panel.ts`: the summary drawer and its Markdown rendering.
- `src/youtube.ts`: every YouTube selector, endpoint and JSON path the extension depends on, plus parsing helpers.
- `src/messages.ts`: message types and helpers between the service worker, content script and page script; settings types.
- `src/store.ts`: storage types and the eviction of the oldest summaries.
- `src/chat.ts`: builds the Copy for chat text.
- `src/options.ts`: options page logic.

## Disclaimer

Unofficial. Not affiliated with or endorsed by YouTube, Google or Anthropic.

## Licence

[MIT](LICENSE)
