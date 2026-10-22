// Every YouTube selector, endpoint and JSON path the extension depends on, plus pure helpers.
// When YouTube changes something, this is the file to fix.

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;

export const SELECTORS = {
  /** YouTube's app element, which routes `yt-action` events. */
  app: 'ytd-app',
  /** Where the watch page Summarise button goes, first match wins. */
  watchActions: [
    'ytd-watch-metadata #actions-inner',
    'ytd-watch-metadata #actions',
    'ytd-watch-metadata #top-row',
  ],
};

export const TRANSCRIPT_PATH = '/youtubei/v1/get_panel?prettyPrint=false';
const TRANSCRIPT_PANEL = 'PAmodern_transcript_view';

/** The ytcfg values the InnerTube requests need, read in the main world. */
export type InnertubeConfig = { context: unknown; clientName: string; clientVersion: string };

export type VideoMeta = { id: string; title: string; channel: string };

export const isVideoId = (id: unknown): id is string =>
  typeof id === 'string' && /^[\w-]{11}$/.test(id);

export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** The video id of a /watch URL, or null for any other page. */
export function watchVideoId(href: string): string | null {
  const url = new URL(href, 'https://www.youtube.com');
  if (url.pathname !== '/watch') return null;
  const id = url.searchParams.get('v');
  return isVideoId(id) ? id : null;
}

/** Protobuf {149: {1: videoId, 3: 1}}, base64: asks get_panel for the transcript panel. */
export function transcriptParams(videoId: string): string {
  return btoa('\xaa\x09\x0f\x0a\x0b' + videoId + '\x18\x01');
}

export function transcriptRequest(cfg: InnertubeConfig, videoId: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': cfg.clientName,
      'X-Youtube-Client-Version': cfg.clientVersion,
    },
    body: JSON.stringify({
      context: cfg.context,
      panelId: TRANSCRIPT_PANEL,
      params: transcriptParams(videoId),
    }),
  };
}

/**
 * Every `transcriptSegmentViewModel.simpleText`, in order. Chapter headings share the panel
 * as `timelineChapterViewModel` and are skipped. An empty result means no transcript.
 */
export function extractTranscript(data: unknown): string[] {
  const lines: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'timelineChapterViewModel') continue;
      if (key === 'transcriptSegmentViewModel' && isObject(value)) {
        if (typeof value.simpleText === 'string') lines.push(value.simpleText);
        continue;
      }
      walk(value);
    }
  };
  walk(data);
  return lines;
}

/** One string, as the CLI sends it: lines joined by spaces, no newlines. */
export const transcriptText = (lines: string[]): string => lines.join(' ').replace(/\n/g, ' ');

/** Title and channel of the watched video from a `yt-navigate-finish` detail, if present. */
export function watchVideo(detail: unknown): VideoMeta | null {
  const details = isObject(detail)
    ? (detail as { response?: { playerResponse?: { videoDetails?: unknown } } }).response
        ?.playerResponse?.videoDetails
    : null;
  if (!isObject(details)) return null;
  const { videoId, title, author } = details;
  if (!isVideoId(videoId) || typeof title !== 'string' || typeof author !== 'string') return null;
  return { id: videoId, title, channel: author };
}

/** Same-origin oEmbed, as the CLI uses for titles: no auth, public data only. */
export const oembedUrl = (id: string): string =>
  `/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`;
