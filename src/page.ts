// MAIN world, document_start. Reads YouTube's own page data and passes the public parts to
// content.ts with postMessage. Never sees the API key or storage. Its only writes are
// YouTube's own Not interested command and, for Watched, the "I've already watched" reason
// YouTube offers after it, both dispatched through YouTube's own router.
import { CONTENT_SOURCE, PAGE_SOURCE, isFrom, post } from './messages';
import {
  BROWSE_PATH,
  FEEDBACK_PATH,
  SELECTORS,
  commandFeedbackToken,
  homeTiles,
  isHomeResponse,
  navResponse,
  sentFeedbackTokens,
  watchVideo,
  watchedReasonToken,
} from './youtube';
import type { ContentMessage, ReasonOutcome } from './messages';
import type { InnertubeConfig } from './youtube';

const NI_TIMEOUT_MS = 5000;

type Ytcfg = { get(key: string): unknown };

// Not interested commands by video id. They stay in this world: content.ts only learns
// that one exists.
const commands = new Map<string, unknown>();
// Watched waits for the Not interested response, keyed by the token its request sends.
const feedbackWaiters = new Map<string, (data: unknown) => void>();

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

/** The feedback tokens a request sends. The Request is cloned now, before sending uses it up. */
function sentTokens(input: RequestInfo | URL, init?: RequestInit): Promise<string[]> {
  const body = input instanceof Request ? input.clone().text() : Promise.resolve(init?.body);
  return body.then((text) =>
    typeof text === 'string' ? sentFeedbackTokens(JSON.parse(text)) : [],
  );
}

/**
 * Continuations and SPA navigation: read /youtubei/v1/browse responses from a clone. While
 * Watched waits, also hand it the response to its Not interested request.
 */
function tapFetch(): void {
  const original = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    let path = '';
    try {
      path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
    } catch {
      // A URL we can't parse is neither a browse nor a feedback request.
    }
    const tokens = path === FEEDBACK_PATH && feedbackWaiters.size ? sentTokens(input, init) : null;
    const pending = original.call(this, input, init);
    if (path === BROWSE_PATH) {
      pending.then((res) => (res.ok ? res.clone().json().then(walk) : undefined)).catch(() => {});
    } else if (tokens) {
      Promise.all([tokens, pending])
        .then(async ([sent, res]) => {
          const waiters = sent.flatMap((token) => feedbackWaiters.get(token) ?? []);
          if (!waiters.length) return;
          const data = res.ok ? await res.clone().json() : null;
          waiters.forEach((resolve) => resolve(data));
        })
        .catch(() => {});
    }
    return pending;
  };
}

/** The JSON response to the feedback request that sends `token`, or null if none in time. */
function feedbackResponse(token: string): Promise<unknown> {
  return new Promise((resolve) => {
    const done = (data: unknown) => {
      if (!feedbackWaiters.delete(token)) return;
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => done(null), NI_TIMEOUT_MS);
    feedbackWaiters.set(token, done);
  });
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

/** Sends a command through ytd-app's `yt-action` router, as YouTube's own menus do. */
function dispatch(app: Element, command: unknown): void {
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
}

const accepted = (status: number | null): boolean =>
  status !== null && status >= 200 && status < 300;

/**
 * Sends the menu's own Not interested command. With `watched`, then sends the "I've already
 * watched" reason from its response, as Tell us why would.
 */
async function notInterested(id: string, watched = false): Promise<void> {
  const command = commands.get(id);
  const app = document.querySelector(SELECTORS.app);
  if (!command || !app) {
    post(PAGE_SOURCE, { type: 'ni-result', id, sent: false, status: null });
    return;
  }
  const token = commandFeedbackToken(command);
  const response = watched && token ? feedbackResponse(token) : null;
  const status = feedbackStatus();
  dispatch(app, command);
  const niStatus = await status;
  if (!watched) {
    post(PAGE_SOURCE, { type: 'ni-result', id, sent: true, status: niStatus });
    return;
  }
  const data = await response;
  const reasonToken = watchedReasonToken(data);
  let reason: ReasonOutcome = data === null ? 'unread' : 'missing';
  if (reasonToken) {
    const reasonStatus = feedbackStatus();
    dispatch(app, {
      commandMetadata: { webCommandMetadata: { sendPost: true } },
      feedbackEndpoint: { feedbackToken: reasonToken },
    });
    const sentStatus = await reasonStatus;
    reason = sentStatus === null ? 'unsent' : accepted(sentStatus) ? 'sent' : 'refused';
  }
  post(PAGE_SOURCE, { type: 'ni-result', id, sent: true, status: niStatus, reason });
}

trapInitialData();
tapFetch();

window.addEventListener('message', (event) => {
  if (!isFrom<ContentMessage>(event, CONTENT_SOURCE)) return;
  const msg = event.data;
  if (msg.type === 'cfg?') {
    post(PAGE_SOURCE, { type: 'cfg', nonce: msg.nonce, cfg: innertubeConfig() });
  } else if (msg.type === 'ni') {
    notInterested(msg.id, msg.watched);
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
