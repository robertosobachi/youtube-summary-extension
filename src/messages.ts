// Messages between extension contexts. The service worker is the only receiver of
// chrome.runtime messages and the only owner of storage and the API key.
import type { InnertubeConfig, VideoMeta } from './youtube';

export const DEFAULT_LANGS = ['en'];

/** Offered on the options page, as lower-case BCP 47 codes. */
export const LANGS = (
  'ar bg bn ca cs da de el en es fa fi fil fr he hi hr hu id it ja ko ms nb nl pl pt pt-br ro ru ' +
  'sk sr sv th tr uk ur vi zh-hans zh-hant'
).split(' ');

/** 0 means off. Steps follow YouTube's rounded dates, so finer values would behave the same. */
export const MAX_AGE_OPTIONS: { label: string; days: number }[] = [
  { label: 'Off', days: 0 },
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year', days: 365 },
  { label: '2 years', days: 730 },
];

export const DEFAULT_MAX_AGE_DAYS = 0;

/** youtube.com localStorage key: content.ts mirrors the cut-off there for page.ts to read. */
export const AGE_KEY = 'yts:maxAgeDays';

/** A cut-off in whole days, 0 for off. Anything unreadable is the default. */
export function parseMaxAgeDays(raw: unknown): number {
  if (raw === '' || raw === null || raw === undefined) return DEFAULT_MAX_AGE_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_MAX_AGE_DAYS;
}

export const DEFAULT_HIDE_PROMOS = false;

/** youtube.com localStorage key: content.ts mirrors the promo toggle there, '1' for on. */
export const PROMOS_KEY = 'yts:hidePromos';

export const DEFAULT_ADD_TO_HISTORY = false;

/**
 * `consent`: the user agreed to send transcripts to Anthropic, as Web Store policy requires.
 * `addToHistory`: new summaries go into YouTube watch history.
 */
export type Settings = {
  apiKey: string;
  consent: boolean;
  langs: string[];
  maxAgeDays: number;
  hidePromos: boolean;
  addToHistory: boolean;
};

/** What extension pages see of the settings: never the key itself. */
export type SettingsView = {
  hasKey: boolean;
  keyHint: string;
  consent: boolean;
  langs: string[];
  maxAgeDays: number;
  hidePromos: boolean;
  addToHistory: boolean;
};

/** Why nothing can be sent to Anthropic yet, or null when a summary can go ahead. */
export function summaryBlocker({ apiKey, consent }: Pick<Settings, 'apiKey' | 'consent'>) {
  if (!apiKey) return 'No API key. Add one in the extension options.';
  if (!consent) return 'Agree to send transcripts to Anthropic in the extension options.';
  return null;
}

export type Summary = {
  title: string;
  channel: string;
  summary: string;
  transcript: string;
  at: number;
};

export type Outcome = { ok: true } | { ok: false; error: string };

export type SummaryResult =
  { ok: true; entry: Summary; warning?: string } | { ok: false; error: string };

type Api = {
  'settings/get': { req: object; res: SettingsView };
  'settings/save': {
    req: { apiKey?: string; consent: boolean; langs: string[]; maxAgeDays: number };
    res: SettingsView;
  };
  'key/test': { req: { apiKey?: string }; res: Outcome };
  // From the options page in its own tab: hand the settings to a YouTube tab's drawer.
  'settings/drawer': { req: object; res: Outcome };
  // Open to content scripts: says whether a key is saved and consent given, nothing more.
  'key/status': { req: object; res: { ready: boolean } };
  // Saved on its own as the box is ticked, so open tabs apply it at once.
  'promos/save': { req: { hidePromos: boolean }; res: SettingsView };
  // Saved on its own as the box is ticked, like the promo toggle.
  'history/save': { req: { addToHistory: boolean }; res: SettingsView };
  // Open to content scripts: whether to add a new summary to YouTube watch history.
  'history/get': { req: object; res: { addToHistory: boolean } };
  // Open to content scripts: the feed filters, which are not private.
  'filter/get': { req: object; res: { maxAgeDays: number; hidePromos: boolean } };
  'summary/get': { req: { id: string }; res: Summary | null };
  // Open to content scripts: which videos have a cached summary, to hide them from feeds.
  'summary/ids': { req: object; res: { ids: string[] } };
  'summary/create': {
    req: { id: string; title: string; channel: string; transcript: string };
    res: SummaryResult;
  };
  'summary/cancel': { req: { id: string }; res: Outcome };
  'rejected/add': { req: VideoMeta; res: Outcome };
};

export type MessageType = keyof Api;
export type Message = { [K in MessageType]: { type: K } & Api[K]['req'] }[MessageType];
export type Reply<K extends MessageType> = Api[K]['res'];

/** Settings and key messages are only accepted from the extension's own pages. */
export const PRIVILEGED: readonly MessageType[] = [
  'settings/get',
  'settings/save',
  'key/test',
  'settings/drawer',
  'promos/save',
  'history/save',
];

/** From the service worker to a content script. */
export type TabMessage =
  | { type: 'settings/open' }
  | { type: 'filter/set'; maxAgeDays: number }
  | { type: 'promos/set'; hidePromos: boolean };

export function send<K extends MessageType>(type: K, req: Api[K]['req']): Promise<Reply<K>> {
  // A reloaded extension leaves the scripts already in open tabs without chrome.runtime.
  if (!chrome.runtime?.id) {
    return Promise.reject(new Error('The extension was reloaded. Reload this page.'));
  }
  return chrome.runtime.sendMessage({ type, ...req });
}

/** Lower-case codes, no duplicates, `en` when none. */
export function normaliseLangs(input: string[]): string[] {
  const codes = input.map((code) => code.trim().toLowerCase()).filter(Boolean);
  return codes.length ? [...new Set(codes)] : DEFAULT_LANGS;
}

// window.postMessage between page.ts (MAIN world) and content.ts (ISOLATED world). Both
// sides check the source tag and `event.source === window`. Page scripts can see these, so
// nothing private ever goes through: no key, no storage data, no feedback commands.

export const PAGE_SOURCE = 'yts-page';
export const CONTENT_SOURCE = 'yts-content';

/** A Home tile as content.ts sees it: `ni` says page.ts holds a Not interested command. */
export type TileMeta = VideoMeta & { ni: boolean };

/**
 * How the already-watched reason went. `unread`: the Not interested response never reached
 * page.ts. `missing`: it did, without the reason. `unsent`: no reason request seen in time.
 */
export type ReasonOutcome = 'sent' | 'unread' | 'missing' | 'unsent' | 'refused';

export type PageMessage =
  | { type: 'cfg'; nonce: string; cfg: InnertubeConfig | null }
  | { type: 'nav'; pageType: string; video: VideoMeta | null }
  | { type: 'tiles'; tiles: TileMeta[] }
  // `sent: false`: nothing was dispatched. `status: null`: no feedback request seen in time.
  // `reason`: Watched only.
  | {
      type: 'ni-result';
      id: string;
      sent: boolean;
      status: number | null;
      reason?: ReasonOutcome;
    };

export type ContentMessage =
  | { type: 'cfg?'; nonce: string }
  // `watched`: follow Not interested with the "I've already watched" reason.
  | { type: 'ni'; id: string; watched?: boolean };

export function isFrom<T>(event: MessageEvent, source: string): event is MessageEvent<T> {
  return (
    event.source === window &&
    typeof event.data === 'object' &&
    event.data !== null &&
    event.data.source === source
  );
}

export function post(source: string, msg: PageMessage | ContentMessage): void {
  window.postMessage({ source, ...msg }, location.origin);
}
