import { describe, expect, it } from 'vitest';
import transcript from '../fixtures/transcript.json';
import { extractTranscript, transcriptParams, transcriptText, watchVideoId } from '../src/youtube';

type Field = { field: number; value: number | Uint8Array };

/** Minimal protobuf reader: varint and length-delimited fields only. */
function decode(bytes: Uint8Array): Field[] {
  const fields: Field[] = [];
  let i = 0;
  const varint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[i++];
      result |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7;
    }
  };
  while (i < bytes.length) {
    const tag = varint();
    const wire = tag & 7;
    if (wire === 0) fields.push({ field: tag >> 3, value: varint() });
    else if (wire === 2) {
      const length = varint();
      fields.push({ field: tag >> 3, value: bytes.slice(i, i + length) });
      i += length;
    } else throw new Error(`unexpected wire type ${wire}`);
  }
  return fields;
}

describe('transcriptParams', () => {
  it('encodes {149: {1: videoId, 3: 1}}', () => {
    const bytes = Uint8Array.from(atob(transcriptParams('dQw4w9WgXcQ')), (c) => c.charCodeAt(0));
    const outer = decode(bytes);
    expect(outer.map((f) => f.field)).toEqual([149]);
    const inner = decode(outer[0].value as Uint8Array);
    expect(inner[0]).toEqual({ field: 1, value: new TextEncoder().encode('dQw4w9WgXcQ') });
    expect(inner[1]).toEqual({ field: 3, value: 1 });
    expect(inner).toHaveLength(2);
  });
});

describe('extractTranscript', () => {
  it('collects segment lines in order and skips chapters', () => {
    const lines = extractTranscript(transcript);
    expect(lines).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Segment ${n}`));
    expect(lines.join(' ')).not.toContain('Chapter');
  });

  it('returns nothing for a panel with zero segments', () => {
    expect(extractTranscript({ responseContext: {}, content: {} })).toEqual([]);
  });

  it('joins lines into one string without newlines', () => {
    expect(transcriptText(['a\nb', 'c'])).toBe('a b c');
  });
});

describe('watchVideoId', () => {
  it('reads v from /watch only', () => {
    expect(watchVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ');
    expect(watchVideoId('https://www.youtube.com/')).toBeNull();
    expect(watchVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
  });
});
