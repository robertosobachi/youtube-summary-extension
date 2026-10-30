// Every YouTube selector, endpoint and JSON path the extension depends on, plus pure helpers.
// When YouTube changes something, this is the file to fix.

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;

export const SELECTORS = {
  /** YouTube's app element, which routes `yt-action` events. */
  app: 'ytd-app',
  /** The watch page player, whose `setPlaybackRate` keeps its own speed menu in step. */
  player: '#movie_player',
  /** Where the watch page Summarise button goes, first match wins. */
  watchActions: [
    // The flex row holding Like/Share; #actions-inner stacks #menu on its own line.
    'ytd-watch-metadata #actions ytd-menu-renderer',
    'ytd-watch-metadata #actions-inner',
    'ytd-watch-metadata #actions',
    'ytd-watch-metadata #top-row',
  ],
  /**
   * Home and Subscriptions feed tiles. YouTube keeps both page elements alive, hidden, on
   * other pages.
   */
  feedTile:
    'ytd-browse:is([page-subtype="home"], [page-subtype="subscriptions"]) ytd-rich-item-renderer',
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
  /**
   * "YouTube featured" promos in a feed: the memberships shelf, Premium trailers, Premium
   * offer banners and the like. Matched by renderer, so in any language.
   */
  promoSection:
    'ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer, ytd-brand-video-singleton-renderer, ytd-statement-banner-renderer)',
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

const UNIT_DAYS: Record<string, number> = {
  second: 1 / 86400,
  sec: 1 / 86400,
  minute: 1 / 1440,
  min: 1 / 1440,
  hour: 1 / 24,
  hr: 1 / 24,
  day: 1,
  week: 7,
  wk: 7,
  month: 30,
  mo: 30,
  year: 365,
  yr: 365,
};

// English only. Accepts a leading word such as "Streamed" or "Premiered".
const RELATIVE_DATE =
  /(?:^|\s)(\d+)\s+(second|sec|minute|min|hour|hr|day|week|wk|month|mo|year|yr)s?\s+ago$/;

/** Days since a relative date such as "3 weeks ago" or "4 hr ago", or null if it isn't one. */
export function parseAgeDays(text: string): number | null {
  const match = RELATIVE_DATE.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * UNIT_DAYS[match[2]];
}

/**
 * The age in days of a video `lockupViewModel`, or null when no metadata part reads as a
 * date. The visible text is abbreviated ("4 hr ago"), so the accessibility label goes first.
 */
export function videoAgeDays(lockup: unknown): number | null {
  const rows = at(lockup, METADATA_ROWS);
  const parts: unknown[] = Array.isArray(rows)
    ? rows.flatMap((row) => at(row, ['metadataParts']) ?? [])
    : [];
  for (const part of parts) {
    for (const text of [at(part, ['accessibilityLabel']), at(part, ['text', 'content'])]) {
      const days = typeof text === 'string' ? parseAgeDays(text) : null;
      if (days !== null) return days;
    }
  }
  return null;
}

// Path from a feed array element to its video.
const FEED_LOCKUP = ['richItemRenderer', 'content', 'lockupViewModel'];

/**
 * Removes, in place, every feed video older than `maxDays`. Only video lockups with a
 * readable date go: ads, Shorts, shelves, live streams and the continuation item stay.
 */
export function removeOldVideos(
  data: unknown,
  maxDays: number,
): { removed: number; total: number } {
  let removed = 0;
  let total = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      let write = 0;
      for (const element of node) {
        const lockup = at(element, FEED_LOCKUP);
        if (isObject(lockup) && lockup.contentType === VIDEO_LOCKUP) {
          total++;
          const age = videoAgeDays(lockup);
          if (age !== null && age > maxDays) {
            removed++;
            continue;
          }
        } else {
          walk(element);
        }
        node[write++] = element;
      }
      node.length = write;
    } else if (isObject(node)) {
      Object.values(node).forEach(walk);
    }
  };
  walk(data);
  return { removed, total };
}

// The renderers of "YouTube featured" promos, as the page elements in SELECTORS.promoSection.
const PROMO_RENDERERS = [
  'brandVideoShelfRenderer',
  'brandVideoSingletonRenderer',
  'statementBannerRenderer',
];

/** True for a feed element holding a YouTube featured promo. Matched by renderer, not text. */
export function isPromoSection(element: unknown): boolean {
  const content = at(element, ['richSectionRenderer', 'content']);
  return isObject(content) && PROMO_RENDERERS.some((key) => key in content);
}

/** Removes, in place, every YouTube featured promo in a feed. Returns how many went. */
export function removePromos(data: unknown): number {
  let removed = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      let write = 0;
      for (const element of node) {
        if (isPromoSection(element)) {
          removed++;
          continue;
        }
        walk(element);
        node[write++] = element;
      }
      node.length = write;
    } else if (isObject(node)) {
      Object.values(node).forEach(walk);
    }
  };
  walk(data);
  return removed;
}

// The watch page's inline player response. /youtubei/v1/player answers UNPLAYABLE without the
// player's attestation token, so the page is the source, as it is for yt-dlp.
const PLAYER_RESPONSE = /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var\s|<\/script>)/s;
const PLAYBACK_URL = ['playbackTracking', 'videostatsPlaybackUrl', 'baseUrl'];
const WATCHTIME_URL = ['playbackTracking', 'videostatsWatchtimeUrl', 'baseUrl'];
const CPN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

/** The `ytInitialPlayerResponse` in a watch page's HTML, or null if none parses. */
export function playerResponse(html: string): unknown {
  const match = PLAYER_RESPONSE.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** A client playback nonce: 16 characters, as the player makes one per playback. */
export const playbackNonce = (bytes = crypto.getRandomValues(new Uint8Array(16))): string =>
  Array.from(bytes, (byte) => CPN_ALPHABET[byte & 63]).join('');

/**
 * A tracking ping at `path` for `id`, reported as played to just before the end, from the watch
 * page rather than Shorts. Undefined unless the URL is a youtube.com one for this video.
 */
function trackingPing(player: unknown, path: string[], id: string, cpn: string): URL | undefined {
  const base = at(player, path);
  if (typeof base !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return undefined;
  }
  const ours = url.protocol === 'https:' && /(^|\.)youtube\.com$/.test(url.hostname);
  if (!ours || url.searchParams.get('docid') !== id) return undefined;
  const len = Number(url.searchParams.get('len') ?? 1.5);
  url.searchParams.set('ver', '2');
  url.searchParams.set('cpn', cpn);
  url.searchParams.set('cmt', String(Number.isFinite(len) ? len - 1 : 0.5));
  url.searchParams.set('el', 'detailpage');
  return url;
}

/**
 * The player's playback and watch-time pings for `id`, in that order, as yt-dlp marks a video
 * watched: the watch-time one, covering start to end, is what adds it to watch history. Empty
 * without a playback ping, as for an unplayable video.
 */
export function historyPingUrls(player: unknown, id: string, cpn: string): string[] {
  const playback = trackingPing(player, PLAYBACK_URL, id, cpn);
  if (!playback) return [];
  const watchtime = trackingPing(player, WATCHTIME_URL, id, cpn);
  if (!watchtime) return [playback.href];
  watchtime.searchParams.set('st', '0');
  watchtime.searchParams.set('et', watchtime.searchParams.get('cmt')!);
  return [playback.href, watchtime.href];
}

/** Same-origin oEmbed, as the CLI uses for titles: no auth, public data only. */
export const oembedUrl = (id: string): string =>
  `/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`;
