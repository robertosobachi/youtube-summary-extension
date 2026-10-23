import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/claude';
import { normaliseLangs } from '../src/messages';

describe('normaliseLangs', () => {
  it('lower-cases and dedupes codes', () => {
    expect(normaliseLangs([' EN', 'it', 'en', 'pt-BR'])).toEqual(['en', 'it', 'pt-br']);
  });

  it('defaults to en when empty', () => {
    expect(normaliseLangs([' ', ''])).toEqual(['en']);
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
