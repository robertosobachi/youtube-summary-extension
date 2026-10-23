// Every YouTube selector, endpoint and JSON path the extension depends on, plus pure helpers.
// When YouTube changes something, this is the file to fix.

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;

export const SELECTORS = {
  /** YouTube's app element, which routes `yt-action` events. */
  app: 'ytd-app',
  /** Where the watch page Summarise button goes, first match wins. */
  watchActions: [
    // The flex row holding Like/Share; #actions-inner stacks #menu on its own line.
    'ytd-watch-metadata #actions ytd-menu-renderer',
    'ytd-watch-metadata #actions-inner',
    'ytd-watch-metadata #actions',
    'ytd-watch-metadata #top-row',
  ],
  /** Home feed tiles. YouTube keeps the Home page element alive, hidden, on other pages. */
  homeTile: 'ytd-browse[page-subtype="home"] ytd-rich-item-renderer',
  /** The tile's own video link; Shorts tiles link to /shorts/ and never match. */
  tileLink: 'a[href*="/watch?v="]',
  /**
   * The thumbnail the tile Summarise button sits on, top right; first match wins, else the
   * tile itself. It must be positioned, as it is for YouTube's own duration badge.
   */
  tileThumbnail: [
    'yt-thumbnail-view-model',
    '.yt-lockup-view-model__content-image',
    '.yt-lockup-view-model-wiz__content-image',
  ],
};

export const BROWSE_PATH = '/youtubei/v1/browse';
export const FEEDBACK_PATH = '/youtubei/v1/feedback';
const HOME_BROWSE_ID = 'FEwhat_to_watch';
const VIDEO_LOCKUP = 'LOCKUP_CONTENT_TYPE_VIDEO';
// Menu items are matched by icon because labels follow the browser's language.
const NOT_INTERESTED_ICON = 'HIDE';
const NOT_INTERESTED_LABEL = 'Not interested';
// "Don't recommend channel": never ours to send.
const NEVER_ICON = 'REMOVE';
// Follow-up reasons have no icon, so only the English label matches: in another language
// no reason is sent rather than the wrong one.
const WATCHED_REASON = /already watched/i;

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

/** A Home video and, when its menu has one, the whole Not interested command. */
export type HomeTile = VideoMeta & { command?: unknown };

/** True when the response is the Home feed: first page, SPA navigation or continuation. */
export function isHomeResponse(data: unknown): boolean {
  const context = isObject(data) ? data.responseContext : null;
  const services = isObject(context) ? context.serviceTrackingParams : null;
  if (!Array.isArray(services)) return false;
  return services.some(
    (service) =>
      isObject(service) &&
      Array.isArray(service.params) &&
      service.params.some(
        (param) => isObject(param) && param.key === 'browse_id' && param.value === HOME_BROWSE_ID,
      ),
  );
}

/** The InnerTube response in a `yt-navigate-finish` detail, when it is Home. */
export function navResponse(detail: unknown): unknown {
  const wrapper = isObject(detail) ? detail.response : null;
  const inner = isObject(wrapper) ? wrapper.response : null;
  return [inner, wrapper].find(isHomeResponse) ?? null;
}

/** Follows object keys from `node`, or undefined at the first missing step. */
const at = (node: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((step, key) => (isObject(step) ? step[key] : undefined), node);

// Paths inside a `lockupViewModel`.
const MENU_ITEMS = [
  'metadata',
  'lockupMetadataViewModel',
  'menuButton',
  'buttonViewModel',
  'onTap',
  'innertubeCommand',
  'showSheetCommand',
  'panelLoadingStrategy',
  'inlineContent',
  'sheetViewModel',
  'content',
  'listViewModel',
  'listItems',
];
const TITLE = ['metadata', 'lockupMetadataViewModel', 'title', 'content'];
const METADATA_ROWS = [
  'metadata',
  'lockupMetadataViewModel',
  'metadata',
  'contentMetadataViewModel',
  'metadataRows',
];
// Inside a menu `listItemViewModel`.
const ITEM_ICON = ['leadingImage', 'sources', '0', 'clientResource', 'imageName'];
const ITEM_LABEL = ['title', 'content'];
const ITEM_COMMAND = ['rendererContext', 'commandContext', 'onTap', 'innertubeCommand'];

/**
 * The lockup menu's Not interested command, whole, as YouTube's own menu would send it.
 * Matched by the HIDE icon, else by the English label; the REMOVE item never matches.
 */
export function notInterestedCommand(lockup: unknown): unknown {
  const items = at(lockup, MENU_ITEMS);
  if (!Array.isArray(items)) return undefined;
  const menu = items.map((item) => at(item, ['listItemViewModel'])).filter(isObject);
  const item =
    menu.find((item) => at(item, ITEM_ICON) === NOT_INTERESTED_ICON) ??
    menu.find(
      (item) => at(item, ITEM_ICON) !== NEVER_ICON && at(item, ITEM_LABEL) === NOT_INTERESTED_LABEL,
    );
  const command = at(item, ITEM_COMMAND);
  return isObject(command) && isObject(command.feedbackEndpoint) ? command : undefined;
}

/** The token a feedback command sends, which is how its request is recognised. */
export function commandFeedbackToken(command: unknown): string | undefined {
  const token = at(command, ['feedbackEndpoint', 'feedbackToken']);
  return typeof token === 'string' ? token : undefined;
}

/** The tokens in a /youtubei/v1/feedback request body. */
export function sentFeedbackTokens(body: unknown): string[] {
  const tokens = at(body, ['feedbackTokens']);
  return Array.isArray(tokens) ? tokens.filter((t): t is string => typeof t === 'string') : [];
}

// Inside a Not interested feedback response: the reasons "Tell us why" offers.
const FOLLOW_UP_REASONS = ['followUpDialog', 'dismissalFollowUpRenderer', 'reasons'];
const REASON = 'dismissalReasonTextRenderer';

/** The "I've already watched this video" reason's token from a Not interested response. */
export function watchedReasonToken(response: unknown): string | undefined {
  const responses = at(response, ['feedbackResponses']);
  if (!Array.isArray(responses)) return undefined;
  for (const reason of responses.flatMap((r) => at(r, FOLLOW_UP_REASONS) ?? [])) {
    const runs = at(reason, [REASON, 'text', 'runs']);
    const label = Array.isArray(runs) ? runs.map((run) => at(run, ['text'])).join('') : '';
    const token = at(reason, [REASON, 'feedbackToken']);
    if (WATCHED_REASON.test(label) && typeof token === 'string') return token;
  }
  return undefined;
}

function homeTile(lockup: Json): HomeTile | null {
  const { contentId, contentType } = lockup;
  if (contentType !== VIDEO_LOCKUP || !isVideoId(contentId)) return null;
  const rows = at(lockup, METADATA_ROWS);
  const parts: unknown[] = Array.isArray(rows)
    ? rows.flatMap((row) => at(row, ['metadataParts']) ?? [])
    : [];
  const title = at(lockup, TITLE);
  const channel = at(parts[0], ['text', 'content']);
  const command = notInterestedCommand(lockup);
  return {
    id: contentId,
    title: typeof title === 'string' ? title : contentId,
    channel: typeof channel === 'string' ? channel : 'unknown channel',
    ...(command ? { command } : {}),
  };
}

/**
 * Every video `lockupViewModel` in a Home response. Ads have no content type and Shorts are
 * `shortsLockupViewModel`, so neither matches. Commands belong to the enclosing lockup.
 */
export function homeTiles(data: unknown): HomeTile[] {
  const tiles: HomeTile[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'lockupViewModel' && isObject(value)) {
        const tile = homeTile(value);
        if (tile) tiles.push(tile);
        continue;
      }
      walk(value);
    }
  };
  walk(data);
  return tiles;
}

/** Same-origin oEmbed, as the CLI uses for titles: no auth, public data only. */
export const oembedUrl = (id: string): string =>
  `/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`;
