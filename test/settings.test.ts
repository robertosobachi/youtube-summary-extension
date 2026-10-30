import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/claude';
import {
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_SPEED,
  MAX_AGE_OPTIONS,
  SPEED_OPTIONS,
  normaliseLangs,
  parseMaxAgeDays,
  parseSpeed,
  summaryBlocker,
  toggledRate,
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

describe('parseSpeed', () => {
  it('offers the default', () => {
    expect(SPEED_OPTIONS).toContain(DEFAULT_SPEED);
  });

  it.each([undefined, null, '', 'abc', 0, 1, 3, NaN])('falls back to default for %j', (raw) => {
    expect(parseSpeed(raw)).toBe(DEFAULT_SPEED);
  });

  it.each([
    [1.25, 1.25],
    ['1.75', 1.75],
    [2, 2],
  ])('reads %j as %j', (raw, speed) => {
    expect(parseSpeed(raw)).toBe(speed);
  });
});

describe('toggledRate', () => {
  it('goes fast from normal', () => {
    expect(toggledRate(1, 1.5)).toBe(1.5);
  });

  it('goes back to normal from fast', () => {
    expect(toggledRate(1.5, 1.5)).toBe(1);
  });

  it("goes back to normal from a rate set in YouTube's own menu", () => {
    expect(toggledRate(2, 1.5)).toBe(1);
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
