# Refeed for YouTube

Triage your YouTube feed: summarise videos with Claude and hide the ones not worth watching.

## What it does

- **Watch page:** adds a Summarise button to the video's action row. The summary opens in a drawer on the right.
- **Feed tiles:** adds a Summarise button over the top-left corner of each video thumbnail on the Home and Subscriptions feeds (grid layout). Shorts are skipped. Watched and Not interested are Home only.
- **Summaries:** built from the video's YouTube transcript. Videos without a transcript show a message instead. Each summary has a title, 2-3 sentence summary, main points and a key takeaway, 250 words maximum.
- **Language:** a transcript in one of your configured languages is summarised in that language, any other in English.
- **Cache:** summaries are saved locally, so opening the same video again doesn't call the API. When storage is full the oldest summaries are dropped.
- **Summarised videos:** hidden from the Home and Subscriptions feeds once summarised, in this browser only. Hiding sends nothing to YouTube. A video comes back if its summary is dropped from the cache. Other open tabs hide it after a reload.
- **Copy for chat:** copies the title, link, summary and full transcript as a ready-made prompt to paste into any chat.
- **Not interested:** in the drawer for a Home tile, sends YouTube's own Not interested command for that video and shows YouTube's response status. The video is also recorded locally.
- **Watched:** a second button on each Home tile, below Summarise. One click sends Not interested, then YouTube's "I've already watched this video" reason, with no summary and no API call. The button shows the result: Done, or where the reason step stopped when only Not interested went through. The reason is matched by its English label, so with YouTube in another language only Not interested is sent.
- **Add to YouTube history:** optional, off by default. After a new summary, sends the playback ping YouTube's player sends when a video starts, so the video shows in your watch history. It also counts as a view. The ping is read from the video's watch page and isn't documented by YouTube, so it can stop working without notice; a failure never affects the summary. Reopening a cached summary sends nothing.
- **Cancel:** closing the drawer while a summary is in progress cancels it, and nothing is saved.
- **Age filter:** hides Home feed videos older than a cut-off before YouTube renders them, so infinite scroll keeps working. Off by default. Ads, Shorts, live streams, premieres without a date and anything unreadable stay. Search, Subscriptions and the watch page are not touched. YouTube shows rounded dates ("1 yr ago" covers 12 to 23 months), so the cut-off works in those steps: a month counts as 30 days and a year as 365. Dates are read in English only.
- **YouTube featured promos:** hides YouTube's own promo sections, such as "Get more from memberships", Premium trailers and Premium offers, from the feeds. Off by default. A toggle in the settings, saved and applied to open YouTube tabs as soon as you change it. Matched by YouTube's renderer type, so in any language: removed from Home responses before YouTube renders them, and hidden by CSS if already on the page. After switching it off, reload YouTube to bring back promos already removed.

## Install

Requires Chrome 120 or later.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and select the `dist/` folder.

## Setup

With no API key saved, the settings open in the drawer on YouTube: once when the page loads, and again whenever you click Summarise. On a YouTube tab, click the extension's toolbar icon to open the settings in its drawer. You can also open the extension's options (Details > Extension options on `chrome://extensions`, Options in the toolbar icon's menu, or the icon on any other tab): they move to the drawer of a YouTube tab, this window's first, and stay a full page when no YouTube tab is open. Fill in:

- **Anthropic API key:** create one in the Claude Console at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). Leave the field empty later to keep the saved key.
- **Send transcripts to Anthropic:** under the key field, required to save a key. Untick it to stop summaries: Summarise then opens the settings and nothing goes to Anthropic.
- **Summary languages:** tick one or more. Defaults to English.
- **Hide Home videos older than:** 1 week to 2 years, or Off. Applies to videos loaded after saving; reload YouTube to refilter the ones already shown.
- **Hide YouTube featured promos:** saved as soon as you tick or untick it, no Save needed.
- **Add summarised videos to YouTube history:** saved as soon as you tick or untick it, too.

Click Save. Test key checks the key against the API without generating a summary.

## Privacy and permissions

**Storage**

- The API key, language list, cached summaries (title, channel, summary, transcript) and your Not interested videos are kept in `chrome.storage.local`, in this browser only.
- Storage is restricted to the extension's own pages and service worker. Content scripts on youtube.com can't read it.
- The age cut-off and the promo toggle are the only settings copied to youtube.com's `localStorage` (`yts:maxAgeDays`, `yts:hidePromos`), because the page script needs them before YouTube's first response. YouTube's scripts can read them.
- Only the service worker reads the key. The options page sees whether a key is saved and its last 4 characters. Content scripts only learn whether a key is saved, plus which video ids have a cached summary, to hide them from feeds.
- In the YouTube drawer, the settings are the options page in a frame. It runs in the extension's own process, so YouTube's scripts can't read the key as you type it.

**What goes to api.anthropic.com**

Nothing is sent to Anthropic for summaries until you tick Send transcripts to Anthropic in the settings.

- On Summarise, when no cached summary exists: the video title, channel name, language instruction and transcript, with your API key. Model: `claude-sonnet-5-5`. Usage is billed to your Anthropic account.
- On Test key: a request for the model's details, authenticated with your key.

**What goes to youtube.com**

- The transcript request and, when a title isn't already known, an oEmbed lookup for title and channel. Both are same-origin requests from the YouTube page.
- Nothing extra for the age and promo filters: they remove items from Home responses YouTube already requested, before YouTube renders them.
- The Not interested command, sent through YouTube's own page code when you click Not interested or Watched. For Watched, also the "I've already watched this video" reason from YouTube's response to it.
- With Add summarised videos to YouTube history ticked, after each new summary: the video's watch page, then the `s.youtube.com/api/stats/playback` ping from its player response, with your YouTube cookies. This adds the video to your watch history and counts as a view.

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
npm run package       # clean build, zipped to refeed-<version>.zip for the Chrome Web Store
npm run icons         # re-render icons/*.png from the SVGs; only needed after editing them
```

`npm ci` also installs a Husky pre-commit hook that runs lint-staged (Prettier and ESLint on staged files).

```sh
node scripts/sanitise-fixtures.mjs
```

Builds the committed test fixtures in `fixtures/` from private YouTube captures in `fixtures/raw/` (git-ignored). It keeps only the JSON structure the code reads, replaces text, ids and tracking values with fakes, and refuses to write anything if a raw string longer than 6 characters survives.

```sh
node scripts/sanitise-age-fixtures.mjs
```

Builds `fixtures/age-browse.json` and `fixtures/age-initial.json` for the age filter tests from the same Home captures, keeping each video's published date.

```sh
node scripts/sanitise-promo-fixtures.mjs
```

Builds `fixtures/promo-initial.json` for the promo filter tests from a Home capture with YouTube featured promos (`fixtures/raw/home-memberships-browse.json`), keeping the feed order and the promos' renderer types.

## Project layout

- `src/background.ts`: service worker. Owns storage, the API key and Claude calls; handles messages from the other contexts.
- `src/claude.ts`: Claude API request, headers, prompt and streamed response parsing.
- `src/content.ts`: content script. Places the Summarise buttons, runs the drawer, fetches transcripts and handles Not interested.
- `src/page.ts`: main-world script. Reads YouTube's page data (Home tiles, config), removes old videos and promos from Home responses and sends YouTube's Not interested command.
- `src/panel.ts`: the summary drawer and its Markdown rendering.
- `src/youtube.ts`: every YouTube selector, endpoint and JSON path the extension depends on, plus parsing helpers.
- `src/messages.ts`: message types and helpers between the service worker, content script and page script; settings types.
- `src/store.ts`: storage types and the eviction of the oldest summaries.
- `src/chat.ts`: builds the Copy for chat text.
- `src/options.ts`: options page logic.

## Disclaimer

Unofficial. Not affiliated with or endorsed by YouTube, Google or Anthropic. YouTube is a trademark of Google LLC.

## Licence

[MIT](LICENSE)
