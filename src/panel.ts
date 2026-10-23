// The right-side drawer, in a closed shadow root. Text only ever goes in through
// textContent: summaries come from a model and titles from YouTube.
import { watchUrl } from './youtube';
import type { VideoMeta } from './youtube';

export type PanelAction = { label: string; run: (button: HTMLButtonElement) => void };

const CSS = `
:host {
  all: initial;
  position: fixed;
  top: var(--ytd-masthead-height, 56px);
  right: 0;
  bottom: 0;
  z-index: 2100;
  width: min(var(--yts-width, 420px), 100vw);
  --accent: #c15f3c;
  /* Fallbacks for YouTube's own colours, which don't always reach the drawer. */
  --bg: #fff;
  --fg: #0f0f0f;
  --muted: #606060;
  --layer: rgba(0, 0, 0, 0.1);
  --chip: rgba(0, 0, 0, 0.05);
  --chip-hover: rgba(0, 0, 0, 0.1);
}
:host-context(html[dark]) {
  --accent: #e08a6d;
  --bg: #0f0f0f;
  --fg: #f1f1f1;
  --muted: #aaa;
  --layer: rgba(255, 255, 255, 0.2);
  --chip: rgba(255, 255, 255, 0.1);
  --chip-hover: rgba(255, 255, 255, 0.2);
}
/* Drag the left edge to resize. */
.resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  z-index: 1;
  cursor: ew-resize;
  touch-action: none;
}
.resize::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.15s;
}
.resize:hover::after, .dragging .resize::after { opacity: 1; }
.dragging { user-select: none; }
.dragging iframe { pointer-events: none; }
.drawer {
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--yt-spec-base-background, var(--bg));
  color: var(--yt-spec-text-primary, var(--fg));
  border-left: 1px solid var(--yt-spec-10-percent-layer, var(--layer));
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.15);
  font: 14px/1.5 Roboto, Arial, sans-serif;
}
header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 16px 16px 8px;
}
.title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--yt-spec-text-secondary, var(--muted));
  overflow-wrap: anywhere;
}
.channel { display: block; font-size: 12px; font-weight: 400; }
.title a { color: var(--yt-spec-text-primary, var(--fg)); font-size: 15px; text-decoration: none; }
.title a:hover { text-decoration: underline; }
.body {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
}
.body.framed { padding: 0; overflow: hidden; }
iframe { display: block; width: 100%; height: 100%; border: 0; }
.body h2 { font-size: 20px; line-height: 1.3; font-weight: 700; margin: 8px 0 4px; }
.body h3 {
  margin: 20px 0 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
}
.body p { margin: 4px 0; }
.body ul { margin: 4px 0; padding-left: 20px; }
.body li { margin: 6px 0; }
.body li::marker { color: var(--accent); }
section:first-of-type p { font-size: 15px; }
/* The last part (Key takeaway) as a callout. */
section:last-of-type:not(:first-of-type) {
  margin-top: 20px;
  padding: 10px 14px;
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
section:last-of-type:not(:first-of-type) h3 { margin-top: 0; }
.status { color: var(--yt-spec-text-secondary, var(--muted)); }
.error { color: var(--yt-spec-brand-button-background, #c00); white-space: pre-wrap; overflow-wrap: anywhere; }
footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--yt-spec-10-percent-layer, var(--layer));
}
footer:empty { display: none; }
button {
  padding: 0 16px;
  height: 36px;
  border: 0;
  border-radius: 18px;
  background: var(--yt-spec-badge-chip-background, var(--chip));
  color: inherit;
  font: 500 14px Roboto, Arial, sans-serif;
  cursor: pointer;
}
button:hover { background: var(--yt-spec-button-chip-background-hover, var(--chip-hover)); }
button:disabled { opacity: 0.6; cursor: default; }
footer button:first-child {
  background: var(--yt-spec-text-primary, var(--fg));
  color: var(--yt-spec-base-background, var(--bg));
}
footer button:first-child:hover { opacity: 0.85; }
.close { padding: 0; width: 36px; flex: none; background: transparent; font-size: 20px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `**bold**` runs as <strong>, the rest as text nodes. */
function inline(parent: HTMLElement, text: string): HTMLElement {
  for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      parent.append(el('strong', undefined, part.slice(2, -2)));
    } else {
      parent.append(document.createTextNode(part));
    }
  }
  return parent;
}

/**
 * The subset of Markdown the summary prompt produces: #, ##, - and **. Each ## heading and
 * what follows it go in a <section>, so the CSS can style the parts by position: the
 * headings come back in the video's language.
 */
export function renderMarkdown(markdown: string): DocumentFragment {
  const out = document.createDocumentFragment();
  let parent: DocumentFragment | HTMLElement = out;
  let list: HTMLUListElement | null = null;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!list) parent.append((list = el('ul')));
      list.append(inline(el('li'), item[1]));
      continue;
    }
    list = null;
    if (!line) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[1].length === 1) {
      out.append(inline(el('h2'), heading[2]));
      parent = out;
    } else if (heading) {
      out.append((parent = el('section')));
      parent.append(inline(el('h3'), heading[2]));
    } else {
      parent.append(inline(el('p'), line));
    }
  }
  return out;
}

const WIDTH_KEY = 'yts-panel-width';
const MIN_WIDTH = 320;

/** localStorage is YouTube's here, which is fine for a width; it can throw or be empty. */
function savedWidth(): number | null {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY));
    return width >= MIN_WIDTH ? width : null;
  } catch {
    return null;
  }
}

function saveWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Not kept: the drawer opens at the default width next time.
  }
}

/** `onClose` runs when you close the drawer yourself, not when the code closes it. */
export function createPanel(onClose: () => void) {
  const host = document.createElement('yts-panel');
  const root = host.attachShadow({ mode: 'closed' });
  const style = el('style', undefined, CSS);
  const drawer = el('div', 'drawer');
  const header = el('header');
  const title = el('h1', 'title');
  const close = el('button', 'close', '×');
  const body = el('div', 'body');
  const footer = el('footer');
  const resize = el('div', 'resize');
  close.title = 'Close';
  resize.title = 'Drag to resize, double-click to reset';
  close.addEventListener('click', () => {
    host.remove();
    onClose();
  });
  header.append(title, close);
  drawer.append(header, body, footer);
  root.append(style, resize, drawer);

  let width = savedWidth();
  const setWidth = (next: number | null): void => {
    width = next;
    if (next === null) host.style.removeProperty('--yts-width');
    else host.style.setProperty('--yts-width', `${next}px`);
  };
  setWidth(width);
  resize.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resize.setPointerCapture(event.pointerId);
    drawer.classList.add('dragging');
  });
  resize.addEventListener('pointermove', (event) => {
    if (!resize.hasPointerCapture(event.pointerId)) return;
    const max = Math.max(MIN_WIDTH, Math.round(innerWidth * 0.9));
    setWidth(Math.min(max, Math.max(MIN_WIDTH, Math.round(innerWidth - event.clientX))));
  });
  resize.addEventListener('lostpointercapture', () => {
    drawer.classList.remove('dragging');
    saveWidth(width);
  });
  resize.addEventListener('dblclick', () => {
    setWidth(null);
    saveWidth(null);
  });

  const open = (heading: string): void => {
    title.textContent = heading;
    body.classList.remove('framed');
    body.replaceChildren();
    footer.replaceChildren();
    if (!host.isConnected) document.body.append(host);
  };

  return {
    /** Opens (or reuses) the drawer for one video and shows a status line. */
    loading(heading: string, text: string): void {
      open(heading);
      body.append(el('p', 'status', text));
    },
    status(text: string): void {
      body.replaceChildren(el('p', 'status', text));
    },
    error(text: string): void {
      body.replaceChildren(el('p', 'error', text));
    },
    /** A summary, under the video's channel and its title linking to the video. */
    show(video: VideoMeta, markdown: string, actions: PanelAction[], note?: string): void {
      open('');
      const link = el('a', undefined, video.title);
      link.href = watchUrl(video.id);
      title.append(el('span', 'channel', video.channel), link);
      body.append(renderMarkdown(markdown));
      if (note) body.append(el('p', 'status', note));
      for (const action of actions) {
        const button = el('button', undefined, action.label);
        button.addEventListener('click', () => action.run(button));
        footer.append(button);
      }
    },
    /** An extension page in a frame: its own process, so the page can't read what you type. */
    frame(heading: string, src: string): void {
      open(heading);
      body.classList.add('framed');
      const frame = el('iframe');
      frame.src = src;
      frame.title = heading;
      body.append(frame);
    },
    close(): void {
      host.remove();
    },
  };
}

export type Panel = ReturnType<typeof createPanel>;
