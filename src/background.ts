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
import { DEFAULT_LANGS, PRIVILEGED, parseLangs } from './messages';
import { evictOldest } from './store';
import { isVideoId } from './youtube';
import type { Message, Outcome, Settings, SettingsView, Summary, SummaryResult } from './messages';
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
  return { apiKey: '', langs: DEFAULT_LANGS, ...(settings as Partial<Settings> | undefined) };
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

function view({ apiKey, langs }: Settings): SettingsView {
  return { hasKey: Boolean(apiKey), keyHint: apiKey.slice(-4), langs };
}

function saveSettings(apiKey: string | undefined, langs: string): Promise<SettingsView> {
  return serialised(async () => {
    const current = await getSettings();
    const next = { apiKey: apiKey?.trim() || current.apiKey, langs: parseLangs(langs) };
    await chrome.storage.local.set({ settings: next });
    return view(next);
  });
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

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'settings/get':
      return view(await getSettings());
    case 'settings/save':
      return saveSettings(msg.apiKey, msg.langs);
    case 'key/test':
      return testKey(msg.apiKey);
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
  handle(msg).then(sendResponse, (err: unknown) =>
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
