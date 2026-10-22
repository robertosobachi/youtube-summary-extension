// The right-side drawer, in a closed shadow root. Text only ever goes in through
// textContent: summaries come from a model and titles from YouTube.

export type PanelAction = { label: string; run: (button: HTMLButtonElement) => void };

const CSS = `
:host {
  all: initial;
  position: fixed;
  top: var(--ytd-masthead-height, 56px);
  right: 0;
  bottom: 0;
  z-index: 2100;
  width: min(420px, 100vw);
}
.drawer {
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--yt-spec-base-background, #fff);
  color: var(--yt-spec-text-primary, #0f0f0f);
  border-left: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
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
  color: var(--yt-spec-text-secondary, #606060);
}
.body {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
}
.body h2 { font-size: 18px; margin: 8px 0; }
.body h3 { font-size: 15px; margin: 16px 0 4px; }
.body p { margin: 4px 0; }
.body ul { margin: 4px 0; padding-left: 20px; }
.status { color: var(--yt-spec-text-secondary, #606060); }
.error { color: var(--yt-spec-brand-button-background, #c00); white-space: pre-wrap; overflow-wrap: anywhere; }
footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
}
footer:empty { display: none; }
button {
  padding: 0 16px;
  height: 36px;
  border: 0;
  border-radius: 18px;
  background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
  color: inherit;
  font: 500 14px Roboto, Arial, sans-serif;
  cursor: pointer;
}
button:hover { background: var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, 0.1)); }
button:disabled { opacity: 0.6; cursor: default; }
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

/** The subset of Markdown the summary prompt produces: #, ##, - and **. */
export function renderMarkdown(markdown: string): DocumentFragment {
  const out = document.createDocumentFragment();
  let list: HTMLUListElement | null = null;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!list) out.append((list = el('ul')));
      list.append(inline(el('li'), item[1]));
      continue;
    }
    list = null;
    if (!line) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) out.append(inline(el(heading[1].length === 1 ? 'h2' : 'h3'), heading[2]));
    else out.append(inline(el('p'), line));
  }
  return out;
}

export function createPanel() {
  const host = document.createElement('yts-panel');
  const root = host.attachShadow({ mode: 'closed' });
  const style = el('style', undefined, CSS);
  const drawer = el('div', 'drawer');
  const header = el('header');
  const title = el('h1', 'title');
  const close = el('button', 'close', '×');
  const body = el('div', 'body');
  const footer = el('footer');
  close.title = 'Close';
  close.addEventListener('click', () => host.remove());
  header.append(title, close);
  drawer.append(header, body, footer);
  root.append(style, drawer);

  const open = (heading: string): void => {
    title.textContent = heading;
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
    show(heading: string, markdown: string, actions: PanelAction[], note?: string): void {
      open(heading);
      body.append(renderMarkdown(markdown));
      if (note) body.append(el('p', 'status', note));
      for (const action of actions) {
        const button = el('button', undefined, action.label);
        button.addEventListener('click', () => action.run(button));
        footer.append(button);
      }
    },
    close(): void {
      host.remove();
    },
  };
}

export type Panel = ReturnType<typeof createPanel>;
