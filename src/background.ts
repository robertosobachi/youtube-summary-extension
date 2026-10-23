// Service worker: sole owner of storage, the API key and Claude calls.
import {
  API,
  MODEL,
  applyEvent,
  emptyStream,
  errorMessage,
  finishSummary,
  headers,
  summaryRequest,
  takeEvents,
} from './claude';
import {
  DEFAULT_LANGS,
  DEFAULT_MAX_AGE_DAYS,
  PRIVILEGED,
  normaliseLangs,
  parseMaxAgeDays,
} from './messages';
import { evictOldest } from './store';
import { isVideoId } from './youtube';
import type {
  Message,
  Outcome,
  Settings,
  SettingsView,
  Summary,
  SummaryResult,
  TabMessage,
} from './messages';
import type { StreamState } from './claude';
import type { Rejected, Summaries } from './store';

// storage.local is exposed to content scripts by default. The docs don't say whether this
// persists, so it is set on every start.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

const QUOTA_RETRIES = 5;
// Extension API calls reset the service worker's 30-second idle timer.
const KEEP_ALIVE_MS = 20_000;

async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return {
    apiKey: '',
    langs: DEFAULT_LANGS,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    ...(settings as Partial<Settings> | undefined),
  };
}

async function getSummaries(): Promise<Summaries> {
  const { summaries } = await chrome.storage.local.get('summaries');
  return (summaries as Summaries | undefined) ?? {};
}

// Writes go one at a time, so two summaries finishing together can't drop each other.
let writes: Promise<unknown> = Promise.resolve();
function serialised<T>(task: () => Promise<T>): Promise<T> {
  const run = writes.then(task);
  writes = run.catch(() => {});
  return run;
}

function view({ apiKey, langs, maxAgeDays }: Settings): SettingsView {
  return { hasKey: Boolean(apiKey), keyHint: apiKey.slice(-4), langs, maxAgeDays };
}

async function saveSettings(
  apiKey: string | undefined,
  langs: string[],
  maxAgeDays: unknown,
): Promise<SettingsView> {
  const saved = await serialised(async () => {
    const current = await getSettings();
    const next = {
      apiKey: apiKey?.trim() || current.apiKey,
      langs: normaliseLangs(langs),
      maxAgeDays: parseMaxAgeDays(maxAgeDays),
    };
    await chrome.storage.local.set({ settings: next });
    return next;
  });
  await broadcastFilter(saved.maxAgeDays);
  return view(saved);
}

/** Hands the age cut-off to every open YouTube tab, for the responses it loads next. */
async function broadcastFilter(maxAgeDays: number): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  const msg: TabMessage = { type: 'filter/set', maxAgeDays };
  // A tab loaded before the extension has no content script to answer.
  await Promise.all(
    tabs.map((tab) => (tab.id ? chrome.tabs.sendMessage(tab.id, msg).catch(() => {}) : null)),
  );
}

/** GET on the summary model: checks the key without billing any tokens. */
async function testKey(apiKey: string | undefined): Promise<Outcome> {
  const key = apiKey?.trim() || (await getSettings()).apiKey;
  if (!key) return { ok: false, error: 'No API key saved.' };
  const res = await fetch(`${API}/models/${MODEL}`, { headers: headers(key) });
  return res.ok ? { ok: true } : { ok: false, error: errorMessage(res.status, await res.text()) };
}

/** POSTs a streamed Messages request and folds its events into one state. */
async function stream(apiKey: string, body: object, signal: AbortSignal): Promise<StreamState> {
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), KEEP_ALIVE_MS);
  try {
    const res = await fetch(`${API}/messages`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      return { ...emptyStream(), error: errorMessage(res.status, await res.text()) };
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let state = emptyStream();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const { data, rest } = takeEvents(buffer + value);
      buffer = rest;
      state = data.reduce(applyEvent, state);
    }
    return takeEvents(buffer + '\n\n').data.reduce(applyEvent, state);
  } finally {
    clearInterval(keepAlive);
  }
}

const isQuotaError = (err: unknown): boolean => err instanceof Error && /quota/i.test(err.message);

/** Saves one summary, evicting the oldest ones while storage is full. */
function storeSummary(id: string, entry: Summary): Promise<void> {
  return serialised(async () => {
    let summaries = { ...(await getSummaries()), [id]: entry };
    for (let attempt = 0; ; attempt++) {
      try {
        await chrome.storage.local.set({ summaries });
        return;
      } catch (err) {
        if (attempt >= QUOTA_RETRIES || !isQuotaError(err)) throw err;
        summaries = evictOldest(summaries, id);
      }
    }
  });
}

async function createSummary(
  id: string,
  title: string,
  channel: string,
  transcript: string,
  signal: AbortSignal,
): Promise<SummaryResult> {
  const { apiKey, langs } = await getSettings();
  if (!apiKey) return { ok: false, error: 'No API key. Add one in the extension options.' };
  const result = finishSummary(
    await stream(apiKey, summaryRequest({ title, channel, langs, transcript }), signal),
  );
  if (!result.ok) return result;
  const entry: Summary = { title, channel, summary: result.text, transcript, at: Date.now() };
  try {
    await storeSummary(id, entry);
    return { ok: true, entry };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: true, entry, warning: `Not cached: ${reason}` };
  }
}

/** Records one of your own Not interested clicks, moved to the end if already there. */
function addRejected(msg: Extract<Message, { type: 'rejected/add' }>): Promise<Outcome> {
  const { id, title, channel } = msg;
  if (!isVideoId(id) || typeof title !== 'string' || typeof channel !== 'string') {
    return Promise.resolve({ ok: false, error: 'Bad rejected request.' });
  }
  return serialised(async () => {
    const { rejected } = await chrome.storage.local.get('rejected');
    const { [id]: _previous, ...rest } = (rejected as Rejected | undefined) ?? {};
    await chrome.storage.local.set({ rejected: { ...rest, [id]: `${title} [${channel}]` } });
    return { ok: true };
  });
}

// A second click while a summary is on its way waits for the same call. Closing the drawer
// aborts it, and nothing is stored.
const pending = new Map<string, { run: Promise<SummaryResult>; abort: AbortController }>();

function summarise(msg: Extract<Message, { type: 'summary/create' }>): Promise<SummaryResult> {
  const { id, title, channel, transcript } = msg;
  if (!isVideoId(id) || !transcript || typeof title !== 'string' || typeof channel !== 'string') {
    return Promise.resolve({ ok: false, error: 'Bad summary request.' });
  }
  let call = pending.get(id);
  if (!call) {
    const abort = new AbortController();
    const run = createSummary(id, title, channel, transcript, abort.signal)
      .catch((err: unknown): SummaryResult => {
        if (abort.signal.aborted) return { ok: false, error: 'Cancelled.' };
        throw err;
      })
      .finally(() => pending.delete(id));
    call = { run, abort };
    pending.set(id, call);
  }
  return call.run;
}

/**
 * Opens the settings in the drawer of a YouTube tab, this window's first, and closes the
 * options tab that asked. Fails when no YouTube tab has the content script listening.
 */
async function openInDrawer(sender: chrome.runtime.MessageSender): Promise<Outcome> {
  const from = sender.tab;
  // Only the options page in its own tab: never the copy framed in the drawer.
  if (!from?.id || sender.frameId !== 0) return { ok: false, error: 'Not a tab.' };
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  const inWindow = tabs.filter((t) => t.windowId === from.windowId);
  const [tab] = (inWindow.length ? inWindow : tabs).sort(
    (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  );
  if (!tab?.id) return { ok: false, error: 'No YouTube tab.' };
  const shown = await showSettings(tab.id);
  if (!shown.ok) return shown;
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.remove(from.id);
  return { ok: true };
}

/** Asks the content script in a YouTube tab to open the settings in its drawer. */
async function showSettings(tabId: number): Promise<Outcome> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'settings/open' } satisfies TabMessage);
    return { ok: true };
  } catch (err) {
    // Loaded before the extension was: no content script to answer.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// The toolbar icon: straight into this tab's drawer, no options tab in between. Elsewhere,
// the options page, which moves itself to a YouTube tab if there is one.
chrome.action.onClicked.addListener(async (tab) => {
  const onYouTube = tab.url?.startsWith('https://www.youtube.com/');
  if (tab.id !== undefined && onYouTube && (await showSettings(tab.id)).ok) return;
  chrome.runtime.openOptionsPage();
});

async function handle(msg: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'settings/get':
      return view(await getSettings());
    case 'settings/save':
      return saveSettings(msg.apiKey, msg.langs, msg.maxAgeDays);
    case 'key/test':
      return testKey(msg.apiKey);
    case 'settings/drawer':
      return openInDrawer(sender);
    case 'key/status':
      return { hasKey: Boolean((await getSettings()).apiKey) };
    case 'filter/get':
      return { maxAgeDays: (await getSettings()).maxAgeDays };
    case 'summary/get':
      return isVideoId(msg.id) ? ((await getSummaries())[msg.id] ?? null) : null;
    case 'summary/create':
      return summarise(msg);
    case 'summary/cancel':
      pending.get(msg.id)?.abort.abort();
      return { ok: true };
    case 'rejected/add':
      return addRejected(msg);
  }
}

function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL('')))
  );
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (PRIVILEGED.includes(msg.type) && !isExtensionPage(sender)) {
    sendResponse({ ok: false, error: 'Not allowed from this context.' });
    return false;
  }
  handle(msg, sender).then(sendResponse, (err: unknown) =>
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
