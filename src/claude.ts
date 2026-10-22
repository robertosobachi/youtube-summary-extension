// Claude API requests and responses, kept pure. Only the service worker sends them.

export const API = 'https://api.anthropic.com/v1';
export const MODEL = 'claude-sonnet-5-5';
const VERSION = '2026-10-21';
// Thinking is always on for this model and counts towards max_tokens.
const MAX_TOKENS = 16000;

// Copied verbatim from yt_summary.py.
export const PROMPT = `Summarise the YouTube transcript you receive.
Write the whole summary, headings included, in the language given on the "Language:" line.

Format:

# <emoji> <title>

## Summary
2-3 sentences.

## Main points
- short bullets

## Key takeaway
One sentence.

Rules: 250 words maximum, no filler, no motivational tone, no inline citations.
Ignore sponsor reads, greetings and requests to subscribe.`;

export function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'anthropic-version': VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  };
}

/** The API's own message for a failed request, shown to the user as is. */
export function errorMessage(status: number, body: string): string {
  try {
    const message = JSON.parse(body)?.error?.message;
    if (typeof message === 'string' && message) return `Claude API ${status}: ${message}`;
  } catch {
    // Not JSON: fall through to the raw body.
  }
  return `Claude API ${status}: ${body || 'no response body'}`;
}

type SummaryInput = { title: string; channel: string; langs: string[]; transcript: string };

/**
 * Streamed, because Chrome stops a service worker whose fetch() response takes more than
 * 30 seconds to arrive, and a summary of a long video can take that long.
 */
export function summaryRequest({ title, channel, langs, transcript }: SummaryInput) {
  const language = `the transcript's own language if it is one of ${langs.join(', ')}; otherwise English`;
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'low' },
    stream: true,
    system: PROMPT,
    messages: [
      {
        role: 'user',
        content: `Title: ${title} (${channel})\nLanguage: ${language}\n\n${transcript}`,
      },
    ],
  };
}

export type StreamState = { text: string; stopReason: string | null; error: string | null };

export const emptyStream = (): StreamState => ({ text: '', stopReason: null, error: null });

/** Splits complete server-sent events off the buffer; `rest` is the unfinished tail. */
export function takeEvents(buffer: string): { data: string[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  const data = blocks
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n'),
    )
    .filter(Boolean);
  return { data, rest };
}

/** Folds one event into the state. Only text deltas count: thinking deltas are dropped. */
export function applyEvent(state: StreamState, data: string): StreamState {
  let event;
  try {
    event = JSON.parse(data);
  } catch {
    return state;
  }
  switch (event?.type) {
    case 'content_block_delta':
      return event.delta?.type === 'text_delta' && typeof event.delta.text === 'string'
        ? { ...state, text: state.text + event.delta.text }
        : state;
    case 'message_delta':
      return { ...state, stopReason: event.delta?.stop_reason ?? state.stopReason };
    case 'error':
      return { ...state, error: `Claude API: ${event.error?.message ?? 'stream error'}` };
    default:
      return state;
  }
}

/** The summary text, or the error to show instead. */
export function finishSummary(
  state: StreamState,
): { ok: true; text: string } | { ok: false; error: string } {
  if (state.error) return { ok: false, error: state.error };
  if (state.stopReason === 'refusal') {
    return { ok: false, error: 'Claude declined to summarise this video (stop_reason: refusal).' };
  }
  const text = state.text.trim();
  if (!text) return { ok: false, error: `No summary returned (stop_reason: ${state.stopReason}).` };
  return { ok: true, text };
}
