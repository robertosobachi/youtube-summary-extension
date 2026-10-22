// MAIN world, document_start. Reads YouTube's own page data and passes the public parts to
// content.ts with postMessage. Never sees the API key or storage. Its one write is
// YouTube's own Not interested command, dispatched through YouTube's own router.
import { CONTENT_SOURCE, PAGE_SOURCE, isFrom, post } from './messages';
import {
  BROWSE_PATH,
  FEEDBACK_PATH,
  SELECTORS,
  homeTiles,
  isHomeResponse,
  navResponse,
  watchVideo,
} from './youtube';
import type { ContentMessage } from './messages';
import type { InnertubeConfig } from './youtube';

const NI_TIMEOUT_MS = 5000;

type Ytcfg = { get(key: string): unknown };

// Not interested commands by video id. They stay in this world: content.ts only learns
// that one exists.
const commands = new Map<string, unknown>();

function innertubeConfig(): InnertubeConfig | null {
  const ytcfg = (window as unknown as { ytcfg?: Ytcfg }).ytcfg;
  const context = ytcfg?.get('INNERTUBE_CONTEXT');
  const clientName = ytcfg?.get('INNERTUBE_CONTEXT_CLIENT_NAME');
  const clientVersion = ytcfg?.get('INNERTUBE_CLIENT_VERSION');
  if (!context || clientName == null || typeof clientVersion !== 'string') return null;
  return { context, clientName: String(clientName), clientVersion };
}

/** Reads the tiles of a Home response and posts them as one batch. */
function walk(data: unknown): void {
  if (!isHomeResponse(data)) return;
  const tiles = homeTiles(data).map(({ command, ...meta }) => {
    if (command) commands.set(meta.id, command);
    return { ...meta, ni: commands.has(meta.id) };
  });
  if (tiles.length) post(PAGE_SOURCE, { type: 'tiles', tiles });
}

/** First load: YouTube assigns `ytInitialData` in an inline script, so trap the assignment. */
function trapInitialData(): void {
  // Another extension may have trapped it first: keep its accessor working.
  const previous = Object.getOwnPropertyDescriptor(window, 'ytInitialData');
  let value: unknown = previous?.value;
  try {
    Object.defineProperty(window, 'ytInitialData', {
      configurable: true,
      enumerable: true,
      get: () => (previous?.get ? previous.get.call(window) : value),
      set: (next: unknown) => {
        if (previous?.set) previous.set.call(window, next);
        else value = next;
        try {
          walk(previous?.get ? previous.get.call(window) : next);
        } catch {
          // Page data we can't read never breaks the page.
        }
      },
    });
  } catch {
    // Not configurable: no Home tiles on a hard load, the rest still works.
  }
}

/** Continuations and SPA navigation: read /youtubei/v1/browse responses from a clone. */
function tapFetch(): void {
  const original = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const pending = original.call(this, input, init);
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === BROWSE_PATH) {
        pending.then((res) => (res.ok ? res.clone().json().then(walk) : undefined)).catch(() => {});
      }
    } catch {
      // A URL we can't parse isn't a browse request.
    }
    return pending;
  };
}

/** The status of the first /youtubei/v1/feedback request YouTube makes from now on. */
function feedbackStatus(): Promise<number | null> {
  const started = performance.now();
  return new Promise((resolve) => {
    const done = (status: number | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(status);
    };
    const observer = new PerformanceObserver((list) => {
      const entry = (list.getEntries() as PerformanceResourceTiming[]).find(
        (e) => e.startTime >= started && new URL(e.name).pathname === FEEDBACK_PATH,
      );
      if (entry) done(entry.responseStatus);
    });
    const timer = setTimeout(() => done(null), NI_TIMEOUT_MS);
    observer.observe({ type: 'resource' });
  });
}

/** Sends the menu's own command through ytd-app's `yt-action` router. */
async function notInterested(id: string): Promise<void> {
  const command = commands.get(id);
  const app = document.querySelector(SELECTORS.app);
  if (!command || !app) {
    post(PAGE_SOURCE, { type: 'ni-result', id, sent: false, status: null });
    return;
  }
  const status = feedbackStatus();
  app.dispatchEvent(
    new CustomEvent('yt-action', {
      bubbles: true,
      composed: true,
      detail: {
        actionName: 'yt-service-request',
        optionalAction: false,
        args: [app, command],
        returnValue: [],
      },
    }),
  );
  post(PAGE_SOURCE, { type: 'ni-result', id, sent: true, status: await status });
}

trapInitialData();
tapFetch();

window.addEventListener('message', (event) => {
  if (!isFrom<ContentMessage>(event, CONTENT_SOURCE)) return;
  const msg = event.data;
  if (msg.type === 'cfg?') {
    post(PAGE_SOURCE, { type: 'cfg', nonce: msg.nonce, cfg: innertubeConfig() });
  } else if (msg.type === 'ni') {
    notInterested(msg.id);
  }
});

document.addEventListener('yt-navigate-finish', (event) => {
  const detail = (event as CustomEvent).detail;
  post(PAGE_SOURCE, {
    type: 'nav',
    pageType: String(detail?.pageType ?? ''),
    video: watchVideo(detail),
  });
  // Back to a Home YouTube had cached: no browse request, so read the navigation's copy.
  walk(navResponse(detail));
});
