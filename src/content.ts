// ISOLATED world: buttons, the drawer and youtube.com fetches. Claude calls and storage go
// through the service worker; page data comes from page.ts by postMessage.
import { chatText } from './chat';
import { CONTENT_SOURCE, PAGE_SOURCE, isFrom, post, send } from './messages';
import { createPanel } from './panel';
import {
  SELECTORS,
  TRANSCRIPT_PATH,
  extractTranscript,
  oembedUrl,
  transcriptRequest,
  transcriptText,
  watchVideoId,
} from './youtube';
import type { PageMessage, Summary } from './messages';
import type { PanelAction } from './panel';
import type { InnertubeConfig, VideoMeta } from './youtube';

const CFG_TIMEOUT_MS = 3000;
// page.ts gives up after 5 s; this only covers page.ts not answering at all.
const NI_TIMEOUT_MS = 6000;

type NiResult = { sent: boolean; status: number | null };
// `ni`: a Home tile offered Not interested for this video.
type Known = VideoMeta & { ni?: boolean };

const panel = createPanel(cancel);
// Titles and channels seen in page data, by video id.
const known = new Map<string, Known>();
const cfgWaiters = new Map<string, (cfg: InnertubeConfig | null) => void>();
const niWaiters = new Map<string, (result: NiResult) => void>();

const remember = (meta: Known): void => {
  known.set(meta.id, { ...known.get(meta.id), ...meta });
};

window.addEventListener('message', (event) => {
  if (!isFrom<PageMessage>(event, PAGE_SOURCE)) return;
  const msg = event.data;
  if (msg.type === 'cfg') {
    cfgWaiters.get(msg.nonce)?.(msg.cfg);
    cfgWaiters.delete(msg.nonce);
  } else if (msg.type === 'nav') {
    if (msg.video) remember(msg.video);
    panel.close();
    scheduleScan();
  } else if (msg.type === 'tiles') {
    msg.tiles.forEach(remember);
  } else if (msg.type === 'ni-result') {
    niWaiters.get(msg.id)?.({ sent: msg.sent, status: msg.status });
    niWaiters.delete(msg.id);
  }
});

/** ytcfg lives in the main world, so ask page.ts for it. */
function innertubeConfig(): Promise<InnertubeConfig | null> {
  const nonce = crypto.randomUUID();
  return new Promise((resolve) => {
    cfgWaiters.set(nonce, resolve);
    post(CONTENT_SOURCE, { type: 'cfg?', nonce });
    setTimeout(() => {
      if (cfgWaiters.delete(nonce)) resolve(null);
    }, CFG_TIMEOUT_MS);
  });
}

/** Asks page.ts to send the tile's Not interested command and waits for the outcome. */
function sendNotInterested(id: string): Promise<NiResult> {
  return new Promise((resolve) => {
    niWaiters.set(id, resolve);
    post(CONTENT_SOURCE, { type: 'ni', id });
    setTimeout(() => {
      if (niWaiters.delete(id)) resolve({ sent: true, status: null });
    }, NI_TIMEOUT_MS);
  });
}

/** Saves the rejection first, then has YouTube's own menu command sent. */
async function notInterested(id: string, entry: Summary, button: HTMLButtonElement) {
  button.disabled = true;
  button.textContent = 'Sending...';
  try {
    const saved = await send('rejected/add', { id, title: entry.title, channel: entry.channel });
    if (!saved.ok) throw new Error(saved.error);
  } catch (err) {
    button.textContent = `Not saved: ${err instanceof Error ? err.message : String(err)}`;
    button.disabled = false;
    return;
  }
  const { sent, status } = await sendNotInterested(id);
  if (!sent) button.textContent = 'Not sent, reload and try again';
  else if (status === null) button.textContent = 'Sent, status unknown';
  else if (status >= 200 && status < 300) button.textContent = `Sent to YouTube (${status})`;
  else {
    // Only a refused request is worth another try.
    button.textContent = `YouTube returned ${status}`;
    button.disabled = false;
  }
}

async function videoMeta(id: string): Promise<VideoMeta> {
  const seen = known.get(id);
  if (seen) return seen;
  try {
    const res = await fetch(oembedUrl(id));
    if (res.ok) {
      const { title, author_name } = await res.json();
      if (typeof title === 'string' && typeof author_name === 'string') {
        const meta = { id, title, channel: author_name };
        known.set(id, meta);
        return meta;
      }
    }
  } catch {
    // Fall back to the id, as the CLI does.
  }
  return { id, title: id, channel: 'unknown channel' };
}

/** The transcript as one string, or null when the video has none. */
async function fetchTranscript(id: string, signal: AbortSignal): Promise<string | null> {
  const cfg = await innertubeConfig();
  if (!cfg) throw new Error("Couldn't read YouTube's page config. Reload the page and try again.");
  const res = await fetch(TRANSCRIPT_PATH, { ...transcriptRequest(cfg, id), signal });
  if (!res.ok) return null;
  const lines = extractTranscript(await res.json());
  return lines.length ? transcriptText(lines) : null;
}

function showSummary(id: string, entry: Summary, fromTile: boolean, note?: string): void {
  const actions: PanelAction[] = [
    {
      label: 'Copy for chat',
      run: async (button) => {
        try {
          await navigator.clipboard.writeText(chatText(id, entry));
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Copy failed';
        }
      },
    },
  ];
  if (fromTile && known.get(id)?.ni) {
    actions.push({ label: 'Not interested', run: (button) => notInterested(id, entry, button) });
  }
  panel.show(`${entry.title} (${entry.channel})`, entry.summary, actions, note);
}

// The latest click wins the drawer; an older one finishing later stays quiet.
let current = 0;
// The summary the open drawer is waiting for, so closing it can cancel the work.
let inFlight: { id: string; abort: AbortController } | null = null;

function cancel(): void {
  current++;
  if (!inFlight) return;
  inFlight.abort.abort();
  send('summary/cancel', { id: inFlight.id }).catch(() => {});
  inFlight = null;
}

async function summarise(id: string, fromTile = false): Promise<void> {
  const ticket = ++current;
  const stale = () => ticket !== current;
  const abort = new AbortController();
  inFlight = { id, abort };
  const meta = known.get(id);
  const heading = meta ? `${meta.title} (${meta.channel})` : 'Summary';
  panel.loading(heading, 'Loading...');
  try {
    const cached = await send('summary/get', { id });
    if (stale()) return;
    if (cached && 'summary' in cached) return showSummary(id, cached, fromTile);

    const { title, channel } = await videoMeta(id);
    panel.loading(`${title} (${channel})`, 'Fetching the transcript...');
    const transcript = await fetchTranscript(id, abort.signal);
    if (stale()) return;
    if (!transcript) return panel.error('No transcript for this video, nothing to summarise.');

    panel.status('Summarising...');
    const result = await send('summary/create', { id, title, channel, transcript });
    if (stale()) return;
    if (result.ok) showSummary(id, result.entry, fromTile, result.warning);
    else panel.error(result.error);
  } catch (err) {
    if (!stale()) panel.error(err instanceof Error ? err.message : String(err));
  } finally {
    if (inFlight?.abort === abort) inFlight = null;
  }
}

// The tile button, over the thumbnail's top-left corner: the top right gets YouTube's own
// hover buttons. A round icon, with the label sliding out on hover so it says what it does.
const OVERLAY_CSS = `
  :host { position: absolute; top: 8px; left: 8px; z-index: 2; margin: 0; }
  button {
    height: 32px; padding: 0 7px; gap: 0; border-radius: 16px;
    background: rgba(255, 255, 255, 0.95); color: #0f0f0f;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    font-size: 12px;
  }
  .label {
    max-width: 0; opacity: 0; overflow: hidden;
    transition: max-width 0.15s, opacity 0.15s, margin 0.15s;
  }
  button:hover, button:focus-visible { background: #fff; }
  button:hover .label, button:focus-visible .label { max-width: 80px; opacity: 1; margin: 0 5px 0 6px; }
  button:active { background: #ececec; }
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Three lines of text and a sparkle: a summary, not a video. Built without markup strings. */
function summaryIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const lines = document.createElementNS(SVG_NS, 'path');
  lines.setAttribute('d', 'M4 6h16M4 11h16M4 16h8');
  lines.setAttribute('fill', 'none');
  lines.setAttribute('stroke', 'currentColor');
  lines.setAttribute('stroke-width', '2.2');
  lines.setAttribute('stroke-linecap', 'round');
  const sparkle = document.createElementNS(SVG_NS, 'path');
  sparkle.setAttribute('d', 'M18 13q.6 3.4 4 4-3.4.6-4 4-.6-3.4-4-4 3.4-.6 4-4z');
  sparkle.setAttribute('fill', 'currentColor');
  svg.append(lines, sparkle);
  return svg;
}

// A small closed-shadow host for our own buttons, so YouTube's CSS can't reach them and
// clicks never reach YouTube's handlers.
function buttonHost(label: string, onClick: () => void, overlay = false): HTMLElement {
  const host = document.createElement('yts-button');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; display: inline-flex; align-items: center; margin-right: 8px; }
    button {
      display: inline-flex; align-items: center; gap: 6px;
      height: 36px; padding: 0 16px 0 12px; border: 0; border-radius: 18px; cursor: pointer;
      background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
      color: var(--yt-spec-text-primary, #0f0f0f);
      font: 500 14px Roboto, Arial, sans-serif;
      white-space: nowrap;
      transition: background-color 0.1s, color 0.1s, transform 0.1s;
    }
    svg { width: 18px; height: 18px; flex: none; color: #d97757; }
    button:hover { background: var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, 0.1)); }
    button:active { transform: scale(0.95); }
    button:focus-visible { outline: 2px solid var(--yt-spec-call-to-action, #065fd4); outline-offset: 2px; }
    ${overlay ? OVERLAY_CSS : ''}
  `;
  const button = document.createElement('button');
  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = label;
  button.setAttribute('aria-label', label);
  button.append(summaryIcon(), text);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  root.append(style, button);
  return host;
}

let watchButton: HTMLElement | null = null;

function placeWatchButton(): void {
  const onWatch = watchVideoId(location.href) !== null;
  if (!onWatch) {
    watchButton?.remove();
    return;
  }
  if (watchButton?.isConnected) return;
  const target = SELECTORS.watchActions
    .map((selector) => document.querySelector(selector))
    .find(Boolean);
  if (!target) return;
  // The id is read at click time: YouTube keeps the same page elements across videos.
  watchButton ??= buttonHost('Summarise', () => {
    const id = watchVideoId(location.href);
    if (id) summarise(id);
  });
  target.prepend(watchButton);
}

// Tiles are reused across SPA navigations, so each scan re-reads the tile's video id.
const tileHosts = new WeakMap<Element, HTMLElement>();
const hostIds = new WeakMap<HTMLElement, string>();

function placeTileButtons(): void {
  for (const tile of document.querySelectorAll(SELECTORS.homeTile)) {
    const link = tile.querySelector<HTMLAnchorElement>(SELECTORS.tileLink);
    const id = link ? watchVideoId(link.href) : null;
    let host = tileHosts.get(tile);
    if (!id) {
      host?.remove();
      continue;
    }
    if (!host) {
      const created = buttonHost(
        'Summarise',
        () => {
          const current = hostIds.get(created);
          if (current) summarise(current, true);
        },
        true,
      );
      tileHosts.set(tile, (host = created));
    }
    hostIds.set(host, id);
    if (!tile.contains(host)) {
      const slot = SELECTORS.tileThumbnail
        .map((selector) => tile.querySelector(selector))
        .find(Boolean);
      (slot ?? tile).append(host);
    }
  }
}

let scanQueued = false;
function scheduleScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    placeWatchButton();
    placeTileButtons();
  });
}

new MutationObserver(scheduleScan).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
