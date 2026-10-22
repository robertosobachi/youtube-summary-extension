import { describe, expect, it } from 'vitest';
import { chatText } from '../src/chat';
import {
  PROMPT,
  applyEvent,
  emptyStream,
  finishSummary,
  summaryRequest,
  takeEvents,
} from '../src/claude';
import { evictOldest } from '../src/store';
import type { Summary } from '../src/messages';

const entry = (at: number): Summary => ({
  title: 'Title',
  channel: 'Channel',
  summary: '# 🎬 Title\n\n## Summary\nText.',
  transcript: 'Words words.',
  at,
});

describe('chatText', () => {
  it('matches the CLI follow-up prompt', () => {
    expect(chatText('dQw4w9WgXcQ', entry(0))).toBe(
      'Below are the summary and transcript of a YouTube video. Answer my questions about it.\n\n' +
        '# Title (Channel)\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\n' +
        '## Summary\n\n# 🎬 Title\n\n## Summary\nText.\n\n## Transcript\n\nWords words.\n',
    );
  });
});

describe('summaryRequest', () => {
  it('sends the CLI prompt and the language rule', () => {
    const body = summaryRequest({ title: 'T', channel: 'C', langs: ['en', 'it'], transcript: 'X' });
    expect(body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low' },
      stream: true,
      system: PROMPT,
    });
    expect(body.messages[0].content).toBe(
      "Title: T (C)\nLanguage: the transcript's own language if it is one of en, it; otherwise English\n\nX",
    );
  });
});

describe('stream reducer', () => {
  const sse = (events: object[]) =>
    events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');

  it('keeps text deltas only and reads the stop reason', () => {
    const raw = sse([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' Hello' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world ' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]);
    // Split mid-event to check the unfinished tail is carried over.
    const cut = raw.length - 20;
    const first = takeEvents(raw.slice(0, cut));
    const second = takeEvents(first.rest + raw.slice(cut));
    const state = [...first.data, ...second.data].reduce(applyEvent, emptyStream());
    expect(second.rest).toBe('');
    expect(finishSummary(state)).toEqual({ ok: true, text: 'Hello world' });
  });

  it('treats refusal, empty text and error events as errors', () => {
    const refused = applyEvent(
      emptyStream(),
      '{"type":"message_delta","delta":{"stop_reason":"refusal"}}',
    );
    expect(finishSummary(refused).ok).toBe(false);
    expect(finishSummary({ ...emptyStream(), stopReason: 'end_turn' })).toEqual({
      ok: false,
      error: 'No summary returned (stop_reason: end_turn).',
    });
    const failed = applyEvent(
      emptyStream(),
      '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    );
    expect(finishSummary(failed)).toEqual({ ok: false, error: 'Claude API: Overloaded' });
  });
});

describe('evictOldest', () => {
  it('drops the oldest 10%, at least one, never the one being saved', () => {
    const summaries = Object.fromEntries(
      Array.from({ length: 20 }, (_, n) => [`id${n}`, entry(n)]),
    );
    expect(Object.keys(evictOldest(summaries, 'id5')).sort()).toEqual(
      Object.keys(summaries)
        .filter((id) => id !== 'id0' && id !== 'id1')
        .sort(),
    );
    expect(Object.keys(evictOldest({ a: entry(0), b: entry(1) }, 'a'))).toEqual(['a']);
  });
});
