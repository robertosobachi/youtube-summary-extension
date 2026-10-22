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

const panel = createPanel();
// Titles and channels seen in page data, by video id.
const known = new Map<string, VideoMeta>();
const cfgWaiters = new Map<string, (cfg: InnertubeConfig | null) => void>();

window.addEventListener('message', (event) => {
  if (!isFrom<PageMessage>(event, PAGE_SOURCE)) return;
  const msg = event.data;
  if (msg.type === 'cfg') {
    cfgWaiters.get(msg.nonce)?.(msg.cfg);
    cfgWaiters.delete(msg.nonce);
  } else if (msg.type === 'nav') {
    if (msg.video) known.set(msg.video.id, msg.video);
    panel.close();
    scheduleScan();
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
async function fetchTranscript(id: string): Promise<string | null> {
  const cfg = await innertubeConfig();
  if (!cfg) throw new Error("Couldn't read YouTube's page config. Reload the page and try again.");
  const res = await fetch(TRANSCRIPT_PATH, transcriptRequest(cfg, id));
  if (!res.ok) return null;
  const lines = extractTranscript(await res.json());
  return lines.length ? transcriptText(lines) : null;
}

function showSummary(id: string, entry: Summary, note?: string): void {
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
  panel.show(`${entry.title} (${entry.channel})`, entry.summary, actions, note);
}

// The latest click wins the drawer; an older one finishing later stays quiet.
let current = 0;

async function summarise(id: string): Promise<void> {
  const ticket = ++current;
  const stale = () => ticket !== current;
  const meta = known.get(id);
  const heading = meta ? `${meta.title} (${meta.channel})` : 'Summary';
  panel.loading(heading, 'Loading...');
  try {
    const cached = await send('summary/get', { id });
    if (stale()) return;
    if (cached && 'summary' in cached) return showSummary(id, cached);

    const { title, channel } = await videoMeta(id);
    panel.loading(`${title} (${channel})`, 'Fetching the transcript...');
    const transcript = await fetchTranscript(id);
    if (stale()) return;
    if (!transcript) return panel.error('No transcript for this video, nothing to summarise.');

    panel.status('Summarising...');
    const result = await send('summary/create', { id, title, channel, transcript });
    if (stale()) return;
    if (result.ok) showSummary(id, result.entry, result.warning);
    else panel.error(result.error);
  } catch (err) {
    if (!stale()) panel.error(err instanceof Error ? err.message : String(err));
  }
}

// A small closed-shadow host for our own buttons, so YouTube's CSS can't reach them and
// clicks never reach YouTube's handlers.
function buttonHost(label: string, onClick: () => void): HTMLElement {
  const host = document.createElement('yts-button');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; display: inline-flex; align-items: center; margin-right: 8px; }
    button {
      height: 36px; padding: 0 16px; border: 0; border-radius: 18px; cursor: pointer;
      background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
      color: var(--yt-spec-text-primary, #0f0f0f);
      font: 500 14px Roboto, Arial, sans-serif;
    }
    button:hover { background: var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, 0.1)); }
  `;
  const button = document.createElement('button');
  button.textContent = label;
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

let scanQueued = false;
function scheduleScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    placeWatchButton();
  });
}

new MutationObserver(scheduleScan).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
