# Chrome Web Store listing

Copy for the developer dashboard. Keep in step with the manifest and PRIVACY.md.

## Store listing tab

**Name:** from the manifest, Refeed for YouTube™

**Summary:** from the manifest description.

**Category:** Productivity

**Description:**

> Triage your YouTube feed: decide what's worth watching before you watch it.
>
> - Summarise: a Summarise button on the watch page and on Home and Subscriptions tiles. The summary opens in a side drawer: a title, a short summary, the main points and a key takeaway, built from the video's transcript by Anthropic's Claude.
> - Hide what you've dealt with: summarised videos drop out of your feeds.
> - Hide old videos: an optional age cut-off for the Home feed.
> - Hide promos: optionally remove YouTube's own promo shelves, such as membership and Premium trailers.
> - Not interested and Watched: one click on a Home tile tells YouTube you've seen it or don't want it.
> - Copy for chat: copies the title, link, summary and transcript as a prompt for any chat.
>
> Bring your own Anthropic API key. Summaries are billed to your Anthropic account and cached in your browser, so a video is never summarised twice. Nothing is sent to Anthropic until you agree in the settings, and the extension has no server of its own.
>
> Unofficial. Not affiliated with or endorsed by YouTube, Google or Anthropic. YouTube is a trademark of Google LLC. Use of this trademark is subject to Google Permissions.

**Assets:**

- Icon: icons/icon-128.png
- Screenshots, 1280x800: the drawer with a summary on a watch page, Home with Summarise and Watched buttons on tiles, the settings in the drawer.
- Small promo tile, 440x280.

## Privacy practices tab

**Single purpose:**

> Helps you triage your YouTube feed and decide what's worth watching: it summarises videos with Claude and hides the ones you don't need to see (already summarised, older than a cut-off, YouTube promos, or marked Not interested or Watched).

**Permission justifications:**

- `storage`: saves the user's settings, API key, cached summaries and videos marked Not interested, on the device only.
- Host `https://www.youtube.com/*`: the content scripts add the Summarise buttons and drawer, fetch the video transcript, filter the Home feed and, when the user turns it on, add summarised videos to their YouTube watch history. YouTube is the only site the extension runs on.
- Host `https://api.anthropic.com/*`: the service worker sends the transcript to Anthropic's Claude API to generate the summary the user asked for, with the user's own API key.
- Web-accessible `options.html`: the settings page is shown in a frame inside the drawer on YouTube, so the user can set it up without leaving the page.
- Main-world content script (`page.js`): reads YouTube's page data for the feed tiles, and removes old videos and promos from the Home responses YouTube already requested, before YouTube renders them. Its only requests are YouTube's own Not interested command and, for Watched, the "I've already watched this video" reason, when the user clicks them.

**Remote code:** No. All code is in the package.

**Data usage (tick):**

- Authentication information: the user's Anthropic API key.
- Website content: video titles, channel names and transcripts.

**Certifications (tick all three):**

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** the hosted PRIVACY.md, e.g. `https://robertosobachi.github.io/youtube-summary-extension/PRIVACY` once GitHub Pages is on.

## Distribution tab

**Visibility:** Unlisted for the first submission.
