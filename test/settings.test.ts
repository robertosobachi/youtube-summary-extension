import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/claude';
import {
  DEFAULT_MAX_AGE_DAYS,
  MAX_AGE_OPTIONS,
  normaliseLangs,
  parseMaxAgeDays,
  summaryBlocker,
} from '../src/messages';

describe('normaliseLangs', () => {
  it('lower-cases and dedupes codes', () => {
    expect(normaliseLangs([' EN', 'it', 'en', 'pt-BR'])).toEqual(['en', 'it', 'pt-br']);
  });

  it('defaults to en when empty', () => {
    expect(normaliseLangs([' ', ''])).toEqual(['en']);
  });
});

describe('parseMaxAgeDays', () => {
  it('defaults to off', () => {
    expect(DEFAULT_MAX_AGE_DAYS).toBe(0);
  });

  it.each([undefined, null, '', 'abc', -5, NaN, '1e999'])('falls back to default for %j', (raw) => {
    expect(parseMaxAgeDays(raw)).toBe(DEFAULT_MAX_AGE_DAYS);
  });

  it.each([
    [30, 30],
    ['365', 365],
    [0, 0],
    ['0', 0],
  ])('reads %j as %j', (raw, days) => {
    expect(parseMaxAgeDays(raw)).toBe(days);
  });

  it('offers the default', () => {
    expect(MAX_AGE_OPTIONS.map((o) => o.days)).toContain(DEFAULT_MAX_AGE_DAYS);
  });
});

describe('summaryBlocker', () => {
  it('needs a key first', () => {
    expect(summaryBlocker({ apiKey: '', consent: true })).toMatch(/No API key/);
  });

  it('needs consent before anything goes to Anthropic', () => {
    expect(summaryBlocker({ apiKey: 'sk-ant-x', consent: false })).toMatch(/Agree/);
  });

  it('lets a summary through with both', () => {
    expect(summaryBlocker({ apiKey: 'sk-ant-x', consent: true })).toBeNull();
  });
});

describe('errorMessage', () => {
  it('shows the API message verbatim', () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'anthropic-workspace-id header is required',
      },
    });
    expect(errorMessage(400, body)).toBe(
      'Claude API 400: anthropic-workspace-id header is required',
    );
  });

  it('falls back to the raw body', () => {
    expect(errorMessage(502, 'Bad gateway')).toBe('Claude API 502: Bad gateway');
  });
});
