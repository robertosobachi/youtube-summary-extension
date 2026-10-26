# Refeed for YouTube privacy policy

Effective 26 October 2026.

Refeed for YouTube is a Chrome extension that summarises YouTube videos with Anthropic's Claude API and hides videos you don't want to see from the YouTube feeds. It has no server of its own. The developer receives no data from it.

## Data the extension handles

- **Your Anthropic API key**, which you enter in the settings.
- **Video details:** title, channel name and transcript of the videos you summarise.
- **Summaries** generated for those videos.
- **Video ids** of videos you mark Not interested or Watched, with their title and channel.
- **Settings:** summary languages, the age cut-off, the promo toggle and the watch history toggle.

## Where it is stored

- All of the above is kept in Chrome's extension storage on your device, in this browser only. YouTube's scripts can't read that storage.
- The age cut-off and the promo toggle are also copied to youtube.com's local storage, because the extension's page script needs them before YouTube loads. YouTube's scripts can read these two values.
- Uninstalling the extension deletes its storage.

## What is sent, and to whom

- **Anthropic (api.anthropic.com):** when you click Summarise and no saved summary exists, the video's title, channel name, transcript and a language instruction are sent with your API key. This happens only after you tick Send transcripts to Anthropic in the settings. Test key sends only your key. Anthropic's handling of this data is covered by [its own policies](https://www.anthropic.com/legal/privacy), and usage is billed to your Anthropic account.
- **YouTube (youtube.com):** the transcript request and, when needed, a title lookup, both from the YouTube page you are on. When you click Not interested or Watched, YouTube's own Not interested command for that video. With Add summarised videos to YouTube history ticked, after each new summary: the video's watch page, then the playback ping YouTube's player sends when a video starts, which adds it to your watch history and counts as a view.

The extension makes no other network requests. There is no analytics, tracking or advertising.

## What the extension does not do

- It does not sell or transfer your data to third parties, other than sending the data above to Anthropic to generate summaries.
- It does not use your data for advertising, creditworthiness or any purpose unrelated to its features.
- Its data handling follows the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the Limited Use requirements.

## Contact

Open an issue at [github.com/robertosobachi/youtube-summary-extension/issues](https://github.com/robertosobachi/youtube-summary-extension/issues).
