// ISOLATED world: buttons, the drawer and youtube.com fetches. Claude calls and storage go
// through the service worker; page data comes from page.ts by postMessage.
import { chatText } from './chat';
import {
  AGE_KEY,
  CONTENT_SOURCE,
  DEFAULT_SPEED,
  PAGE_SOURCE,
  PROMOS_KEY,
  isFrom,
  post,
  send,
  toggledRate,
} from './messages';
import { createPanel } from './panel';
import {
  SELECTORS,
  TRANSCRIPT_PATH,
  extractTranscript,
  oembedUrl,
  transcriptRequest,
  transcriptText,
  watchUrl,
  watchVideoId,
} from './youtube';
import type { PageMessage, ReasonOutcome, Summary, TabMessage } from './messages';
import type { PanelAction } from './panel';
import type { InnertubeConfig, VideoMeta } from './youtube';

const CFG_TIMEOUT_MS = 3000;
// page.ts gives up after 5 s; this only covers page.ts not answering at all.
const NI_TIMEOUT_MS = 6000;
// Long enough to read Watched's result before its tile goes.
const HIDE_DELAY_MS = 1500;

type NiResult = { sent: boolean; status: number | null; reason?: ReasonOutcome };
// `ni`: a Home tile offered Not interested for this video.
type Known = VideoMeta & { ni?: boolean };

const panel = createPanel(cancel);
// Titles and channels seen in page data, by video id.
const known = new Map<string, Known>();
// Videos summarised or marked Watched or Not interested: their feed tiles are hidden, in this
// browser only.
const hidden = new Set<string>();
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
    promptForKey();
    showSpeed();
    scheduleScan();
  } else if (msg.type === 'tiles') {
    msg.tiles.forEach(remember);
    // Tiles drawn before their data arrived get their Watched button now.
    scheduleScan();
  } else if (msg.type === 'ni-result') {
    niWaiters.get(msg.id)?.({ sent: msg.sent, status: msg.status, reason: msg.reason });
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

/**
 * Asks page.ts to send the tile's Not interested command, and with `watched` the reason
 * after it, and waits for the outcome.
 */
function sendNotInterested(id: string, watched = false): Promise<NiResult> {
  return new Promise((resolve) => {
    niWaiters.set(id, resolve);
    post(CONTENT_SOURCE, { type: 'ni', id, watched });
    // Watched waits on two requests in page.ts.
    setTimeout(
      () => {
        if (niWaiters.delete(id)) resolve({ sent: true, status: null });
      },
      watched ? NI_TIMEOUT_MS * 2 : NI_TIMEOUT_MS,
    );
  });
}

// Watched labels when Not interested went but the reason didn't, by where it stopped.
const REASON_FAILED: Record<Exclude<ReasonOutcome, 'sent'>, string> = {
  unread: 'Reply unread',
  missing: 'No reason offered',
  unsent: 'Reason not sent',
  refused: 'Reason refused',
};

/** The tile's Watched button: Not interested plus "I've already watched", no drawer. */
async function markWatched(id: string, button: HTMLButtonElement, label: HTMLElement) {
  button.disabled = true;
  button.dataset.state = '';
  label.textContent = 'Sending...';
  const meta = known.get(id) ?? { id, title: id, channel: 'unknown channel' };
  try {
    const saved = await send('rejected/add', { id, title: meta.title, channel: meta.channel });
    if (!saved.ok) throw new Error(saved.error);
  } catch {
    label.textContent = 'Not saved';
    button.disabled = false;
    return;
  }
  const { sent, status, reason } = await sendNotInterested(id, true);
  const ok = status !== null && status >= 200 && status < 300;
  if (!sent) label.textContent = 'Reload page';
  else if (reason === 'sent') label.textContent = 'Done';
  else if (reason) label.textContent = REASON_FAILED[reason];
  else if (ok) label.textContent = 'No reason sent';
  else if (status === null) label.textContent = 'Unknown';
  else {
    label.textContent = `Error ${status}`;
    button.disabled = false;
  }
  // A refused request stays for another try; anything else is final.
  if (button.disabled) setTimeout(() => hideTile(id), HIDE_DELAY_MS);
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

const copyAction = (label: string, text: string): PanelAction => ({
  label,
  run: async (button) => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
  },
});

function showSummary(id: string, entry: Summary, fromTile: boolean, note?: string): void {
  const actions: PanelAction[] = [
    copyAction('Copy for chat', chatText(id, entry)),
    copyAction('Copy link', watchUrl(id)),
  ];
  if (fromTile && known.get(id)?.ni) {
    actions.push({ label: 'Not interested', run: (button) => notInterested(id, entry, button) });
  }
  panel.show({ id, title: entry.title, channel: entry.channel }, entry.summary, actions, note);
}

// The frame can't see YouTube's theme, which needn't match the system's, so it's passed along.
const openSettings = (): void => {
  const theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
  panel.frame('Settings', chrome.runtime.getURL(`options.html?theme=${theme}`));
};

// The extension's Options entry and saved filters, handed over by the service worker.
chrome.runtime.onMessage.addListener((msg: TabMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg.type === 'filter/set') {
    mirrorFilter(msg.maxAgeDays);
  } else if (msg.type === 'promos/set') {
    applyPromos(msg.hidePromos);
  } else if (msg.type === 'speed/set') {
    fastSpeed = msg.speed;
    showSpeed();
  } else if (msg.type === 'settings/open') {
    // Like the close button: a summary still on its way mustn't replace the settings.
    cancel();
    openSettings();
  } else {
    return false;
  }
  sendResponse({ ok: true });
  return false;
});

/**
 * page.ts can't reach the service worker and needs the cut-off before the first response,
 * so it reads this page's localStorage. A change reaches the next page load at the latest.
 */
function mirrorFilter(maxAgeDays: number): void {
  try {
    localStorage.setItem(AGE_KEY, String(maxAgeDays));
  } catch {
    // Storage blocked: page.ts keeps the last value it can read, or the default.
  }
}

// page.ts removes promos from the responses it sees; this hides the ones already drawn, so
// the toggle applies at once. Turning it off shows those again, not the ones page.ts removed.
const promoStyle = document.createElement('style');
promoStyle.textContent = `${SELECTORS.promoSection} { display: none !important; }`;

function applyPromos(hide: boolean): void {
  try {
    localStorage.setItem(PROMOS_KEY, hide ? '1' : '0');
  } catch {
    // Storage blocked: page.ts leaves responses alone and the style does all the hiding.
  }
  if (hide) (document.head ?? document.documentElement).append(promoStyle);
  else promoStyle.remove();
}

send('filter/get', {})
  .then(({ maxAgeDays, hidePromos }) => {
    mirrorFilter(maxAgeDays);
    applyPromos(hidePromos);
  })
  .catch(() => {});

function hideTile(id: string): void {
  hidden.add(id);
  scheduleScan();
}

send('summary/ids', {})
  .then(({ ids }) => ids.forEach(hideTile))
  .catch(() => {});

send('rejected/ids', {})
  .then(({ ids }) => ids.forEach(hideTile))
  .catch(() => {});

async function ready(): Promise<boolean> {
  return (await send('key/status', {})).ready;
}

// Once per page load: closing the settings keeps them closed until the next reload.
let keyPrompted = false;
function promptForKey(): void {
  if (keyPrompted) return;
  keyPrompted = true;
  ready()
    .then((ok) => {
      if (!ok) openSettings();
    })
    .catch(() => {});
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
    if (cached && 'summary' in cached) {
      hideTile(id);
      return showSummary(id, cached, fromTile);
    }

    const canSend = await ready();
    if (stale()) return;
    if (!canSend) return openSettings();

    const { title, channel } = await videoMeta(id);
    panel.loading(`${title} (${channel})`, 'Fetching the transcript...');
    const transcript = await fetchTranscript(id, abort.signal);
    if (stale()) return;
    if (!transcript) return panel.error('No transcript for this video, nothing to summarise.');

    panel.status('Summarising...');
    const result = await send('summary/create', { id, title, channel, transcript });
    if (stale()) return;
    if (result.ok) {
      hideTile(id);
      showSummary(id, result.entry, fromTile, result.warning);
    } else panel.error(result.error);
  } catch (err) {
    if (!stale()) panel.error(err instanceof Error ? err.message : String(err));
  } finally {
    if (inFlight?.abort === abort) inFlight = null;
  }
}

// The tile buttons, stacked down the thumbnail's top-left corner: the top right gets
// YouTube's own hover buttons. A round icon, with the label sliding out on hover so it says
// what it does, and staying out once the button has a result to show.
const overlayCss = (row: number): string => `
  :host { position: absolute; top: ${8 + row * 40}px; left: 8px; z-index: 2; margin: 0; }
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
  button:hover .label, button:focus-visible .label, button[data-state] .label {
    max-width: 120px; opacity: 1; margin: 0 5px 0 6px;
  }
  button:active { background: #ececec; }
  button:disabled { cursor: default; }
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

/** An eye with a tick: already watched. */
function watchedIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const eye = document.createElementNS(SVG_NS, 'path');
  eye.setAttribute('d', 'M2 11q5-7 10-7t10 7M2 11q5 7 10 7M15 11a3 3 0 1 1-6 0 3 3 0 1 1 6 0');
  eye.setAttribute('fill', 'none');
  eye.setAttribute('stroke', 'currentColor');
  eye.setAttribute('stroke-width', '2.2');
  eye.setAttribute('stroke-linecap', 'round');
  const tick = document.createElementNS(SVG_NS, 'path');
  tick.setAttribute('d', 'M15 17.5l2.5 2.5 5-5');
  tick.setAttribute('fill', 'none');
  tick.setAttribute('stroke', 'currentColor');
  tick.setAttribute('stroke-width', '2.2');
  tick.setAttribute('stroke-linecap', 'round');
  tick.setAttribute('stroke-linejoin', 'round');
  svg.append(eye, tick);
  return svg;
}

/** A speedometer: the speed button. */
function speedIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const dial = document.createElementNS(SVG_NS, 'path');
  dial.setAttribute('d', 'M3 18a9 9 0 1 1 18 0');
  dial.setAttribute('fill', 'none');
  dial.setAttribute('stroke', 'currentColor');
  dial.setAttribute('stroke-width', '2.2');
  dial.setAttribute('stroke-linecap', 'round');
  const needle = document.createElementNS(SVG_NS, 'path');
  needle.setAttribute('d', 'M12 18l4.5-6');
  needle.setAttribute('fill', 'none');
  needle.setAttribute('stroke', 'currentColor');
  needle.setAttribute('stroke-width', '2.2');
  needle.setAttribute('stroke-linecap', 'round');
  svg.append(dial, needle);
  return svg;
}

type ButtonOptions = {
  /** Row on the thumbnail, from the top; without it, an inline button. */
  overlayRow?: number;
  icon?: () => SVGSVGElement;
  /** Gets the button and its label once, for a button that updates outside its clicks. */
  bind?: (button: HTMLButtonElement, label: HTMLElement) => void;
};

// A small closed-shadow host for our own buttons, so YouTube's CSS can't reach them and
// clicks never reach YouTube's handlers. `onClick` gets the button and its label to update.
function buttonHost(
  label: string,
  onClick: (button: HTMLButtonElement, label: HTMLElement) => void,
  { overlayRow, icon = summaryIcon, bind }: ButtonOptions = {},
): HTMLElement {
  const host = document.createElement('yts-button');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial; display: inline-flex; align-items: center; align-self: center; margin: 0 8px 8px 0;
      /* Fallbacks for YouTube's own colours, which don't always reach the button. */
      --fg: #0f0f0f;
      --bg: #fff;
      --chip: rgba(0, 0, 0, 0.05);
      --chip-hover: rgba(0, 0, 0, 0.1);
    }
    :host-context(html[dark]) {
      --fg: #f1f1f1;
      --bg: #0f0f0f;
      --chip: rgba(255, 255, 255, 0.1);
      --chip-hover: rgba(255, 255, 255, 0.2);
    }
    button {
      display: inline-flex; align-items: center; gap: 6px;
      height: 40px; padding: 0 16px 0 12px; border: 0; border-radius: 20px; cursor: pointer;
      background: var(--yt-spec-badge-chip-background, var(--chip));
      color: var(--yt-spec-text-primary, var(--fg));
      font: 500 14px Roboto, Arial, sans-serif;
      white-space: nowrap;
      transition: background-color 0.1s, color 0.1s, transform 0.1s;
    }
    svg { width: 18px; height: 18px; flex: none; color: #d97757; }
    button:hover { background: var(--yt-spec-button-chip-background-hover, var(--chip-hover)); }
    /* On, like YouTube's own toggled chips. After :hover, so hovering keeps it. */
    button[aria-pressed='true'] {
      background: var(--yt-spec-text-primary, var(--fg));
      color: var(--yt-spec-base-background, var(--bg));
    }
    button:active { transform: scale(0.95); }
    button:focus-visible { outline: 2px solid var(--yt-spec-call-to-action, #065fd4); outline-offset: 2px; }
    ${overlayRow === undefined ? '' : overlayCss(overlayRow)}
  `;
  const button = document.createElement('button');
  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = label;
  text.setAttribute('aria-live', 'polite');
  button.setAttribute('aria-label', label);
  button.append(icon(), text);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(button, text);
  });
  root.append(style, button);
  bind?.(button, text);
  return host;
}

let watchButton: HTMLElement | null = null;
let speedButton: HTMLElement | null = null;
// The fast rate, from the settings, and the speed button's parts to show it and its state.
let fastSpeed = DEFAULT_SPEED;
let speedParts: { button: HTMLButtonElement; label: HTMLElement } | null = null;

const playerVideo = (): HTMLVideoElement | null =>
  document.querySelector<HTMLVideoElement>(`${SELECTORS.player} video`);

/** The fast rate as the label, pressed while the player runs at anything but normal. */
function showSpeed(): void {
  if (!speedParts) return;
  const { button, label } = speedParts;
  label.textContent = `${fastSpeed}x`;
  button.setAttribute('aria-label', `${fastSpeed}x speed`);
  button.setAttribute('aria-pressed', String((playerVideo()?.playbackRate ?? 1) !== 1));
}

// The player's video can be swapped, and ratechange doesn't bubble: capture catches any.
// It also follows YouTube's own speed menu and shortcuts.
document.addEventListener('ratechange', showSpeed, true);

send('speed/get', {})
  .then(({ speed }) => {
    fastSpeed = speed;
    showSpeed();
  })
  .catch(() => {});

/** Normal to fast, anything else back to normal. page.ts sets it through the player. */
function toggleSpeed(): void {
  const rate = toggledRate(playerVideo()?.playbackRate ?? 1, fastSpeed);
  post(CONTENT_SOURCE, { type: 'speed', rate });
}

function placeWatchButton(): void {
  const onWatch = watchVideoId(location.href) !== null;
  if (!onWatch) {
    watchButton?.remove();
    speedButton?.remove();
    return;
  }
  const target = SELECTORS.watchActions
    .map((selector) => document.querySelector(selector))
    .find(Boolean);
  if (!target) return;
  // A fallback container can render before the menu; move up once the better one appears.
  if (watchButton?.parentElement === target && speedButton?.parentElement === target) return;
  // The id is read at click time: YouTube keeps the same page elements across videos.
  watchButton ??= buttonHost('Summarise', () => {
    const id = watchVideoId(location.href);
    if (id) summarise(id);
  });
  // Just before Like, as a sibling: inside #top-level-buttons-computed YouTube would wipe it.
  const before = target.querySelector(':scope > #top-level-buttons-computed, :scope > #menu');
  speedButton ??= buttonHost(`${fastSpeed}x`, toggleSpeed, {
    icon: speedIcon,
    bind: (button, label) => {
      speedParts = { button, label };
    },
  });
  target.insertBefore(watchButton, before);
  target.insertBefore(speedButton, before);
  showSpeed();
}

// Tiles are reused across SPA navigations, so each scan re-reads the tile's video id.
const tileHosts = new WeakMap<Element, HTMLElement>();
const hostIds = new WeakMap<HTMLElement, string>();
// Watched buttons hold their result, so a reused tile gets a fresh one for its new video.
const watchedHosts = new WeakMap<Element, { host: HTMLElement; id: string }>();

// Our own attribute, not `hidden`: YouTube's elements set that themselves.
const HIDDEN_ATTR = 'data-yts-hidden';
const hideStyle = document.createElement('style');
hideStyle.textContent = `[${HIDDEN_ATTR}] { display: none !important; }`;

function placeTileButtons(): void {
  if (!hideStyle.isConnected) (document.head ?? document.documentElement).append(hideStyle);
  for (const tile of document.querySelectorAll(SELECTORS.feedTile)) {
    const link = tile.querySelector<HTMLAnchorElement>(SELECTORS.tileLink);
    const id = link ? watchVideoId(link.href) : null;
    // Re-read every scan: a reused tile shows again once it holds another video.
    tile.toggleAttribute(HIDDEN_ATTR, id !== null && hidden.has(id));
    let host = tileHosts.get(tile);
    const watched = watchedHosts.get(tile);
    if (watched && watched.id !== id) {
      watched.host.remove();
      watchedHosts.delete(tile);
    }
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
        { overlayRow: 0 },
      );
      tileHosts.set(tile, (host = created));
    }
    hostIds.set(host, id);
    const slot =
      SELECTORS.tileThumbnail.map((selector) => tile.querySelector(selector)).find(Boolean) ?? tile;
    if (!tile.contains(host)) slot.append(host);
    // Only where page.ts holds a Not interested command for this video.
    if (!known.get(id)?.ni) continue;
    let watchedHost = watchedHosts.get(tile)?.host;
    if (!watchedHost) {
      watchedHost = buttonHost('Watched', (button, label) => markWatched(id, button, label), {
        overlayRow: 1,
        icon: watchedIcon,
      });
      watchedHosts.set(tile, { host: watchedHost, id });
    }
    if (!tile.contains(watchedHost)) slot.append(watchedHost);
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
