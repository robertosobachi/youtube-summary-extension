import { describe, expect, it } from 'vitest';
import feedbackNi from '../fixtures/feedback-ni.json';
import homeBrowse from '../fixtures/home-browse.json';
import homeInitial from '../fixtures/home-initial.json';
import transcript from '../fixtures/transcript.json';
import {
  commandFeedbackToken,
  extractTranscript,
  homeTiles,
  isHomeResponse,
  navResponse,
  notInterestedCommand,
  sentFeedbackTokens,
  transcriptParams,
  transcriptText,
  watchVideoId,
  watchedReasonToken,
} from '../src/youtube';

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

const token = (command: unknown): unknown =>
  (command as { feedbackEndpoint?: { feedbackToken?: unknown } } | undefined)?.feedbackEndpoint
    ?.feedbackToken;

/** The first fixture lockup, deep-copied, with its menu items passed through `edit`. */
function lockupWith(edit: (items: { listItemViewModel: Record<string, unknown> }[]) => unknown[]) {
  const lockup = structuredClone(
    homeInitial.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer
      .contents[0].richItemRenderer!.content.lockupViewModel!,
  );
  const list =
    lockup.metadata.lockupMetadataViewModel.menuButton.buttonViewModel.onTap.innertubeCommand
      .showSheetCommand.panelLoadingStrategy.inlineContent.sheetViewModel.content.listViewModel;
  (list as { listItems: unknown[] }).listItems = edit(list.listItems);
  return lockup;
}

describe('homeTiles', () => {
  it('finds each video lockup with its title and channel', () => {
    expect(
      homeTiles(homeInitial).map(({ id, title, channel }) => ({ id, title, channel })),
    ).toEqual(
      [1, 2, 3].map((n) => ({
        id: `fakeVideo0${n}`,
        title: `Video ${n}`,
        channel: `Channel ${n}`,
      })),
    );
  });

  it('takes the HIDE item, never the REMOVE item', () => {
    const [first, second] = homeTiles(homeInitial);
    expect(token(first.command)).toBe('ni-fakeVideo01');
    expect(token(second.command)).toBe('ni-fakeVideo02');
  });

  it('falls back to the English label when the icon is missing', () => {
    const third = homeTiles(homeInitial)[2];
    expect(token(third.command)).toBe('ni-fakeVideo03');
  });

  it('attributes each command to its own lockup in a continuation', () => {
    const tiles = homeTiles(homeBrowse);
    expect(tiles.map((tile) => [tile.id, token(tile.command)])).toEqual([
      ['fakeVideo04', 'ni-fakeVideo04'],
      ['fakeVideo05', 'ni-fakeVideo05'],
    ]);
  });

  it('ignores Shorts', () => {
    expect(homeTiles(homeInitial).map((tile) => tile.id)).not.toContain('fakeShort01');
    expect(JSON.stringify(homeInitial)).toContain('fakeShort01');
  });
});

describe('notInterestedCommand', () => {
  it('returns the whole command, not just the token', () => {
    const command = notInterestedCommand(lockupWith((items) => items));
    expect(command).toEqual({
      commandMetadata: { webCommandMetadata: { sendPost: true } },
      feedbackEndpoint: { feedbackToken: 'ni-fakeVideo01' },
    });
  });

  it('never matches REMOVE, even when the HIDE item is gone', () => {
    const lockup = lockupWith((items) =>
      items.filter((item) => JSON.stringify(item).includes('REMOVE')),
    );
    expect(notInterestedCommand(lockup)).toBeUndefined();
  });

  it('never matches REMOVE, even under the Not interested label', () => {
    const lockup = lockupWith((items) =>
      items
        .filter((item) => JSON.stringify(item).includes('REMOVE'))
        .map((item) => ({
          listItemViewModel: { ...item.listItemViewModel, title: { content: 'Not interested' } },
        })),
    );
    expect(notInterestedCommand(lockup)).toBeUndefined();
  });
});

describe('commandFeedbackToken', () => {
  it('reads the token the command sends', () => {
    const command = notInterestedCommand(lockupWith((items) => items));
    expect(commandFeedbackToken(command)).toBe('ni-fakeVideo01');
    expect(commandFeedbackToken({})).toBeUndefined();
  });
});

describe('sentFeedbackTokens', () => {
  it('reads the tokens of a feedback request body', () => {
    expect(sentFeedbackTokens({ context: {}, feedbackTokens: ['a', 1, 'b'] })).toEqual(['a', 'b']);
    expect(sentFeedbackTokens({ context: {} })).toEqual([]);
  });
});

describe('watchedReasonToken', () => {
  /** The fixture, deep-copied, with each reason's label passed through `relabel`. */
  const relabelled = (relabel: (label: string) => string) => {
    const copy = structuredClone(feedbackNi);
    for (const reason of copy.feedbackResponses[0].followUpDialog.dismissalFollowUpRenderer
      .reasons) {
      const run = reason.dismissalReasonTextRenderer.text.runs[0];
      run.text = relabel(run.text);
    }
    return copy;
  };

  it('picks the already watched reason, not the first one', () => {
    expect(watchedReasonToken(feedbackNi)).toBe('reason-1');
    const reversed = structuredClone(feedbackNi);
    reversed.feedbackResponses[0].followUpDialog.dismissalFollowUpRenderer.reasons.reverse();
    expect(watchedReasonToken(reversed)).toBe('reason-1');
  });

  it('sends no reason when the labels are in another language', () => {
    expect(watchedReasonToken(relabelled(() => 'Ho già visto questo video'))).toBeUndefined();
  });

  it('is undefined for a missing or unexpected response', () => {
    expect(watchedReasonToken(null)).toBeUndefined();
    expect(watchedReasonToken({ feedbackResponses: [{ isProcessed: true }] })).toBeUndefined();
  });
});

describe('isHomeResponse', () => {
  it('is true for Home first loads and continuations', () => {
    expect(isHomeResponse(homeInitial)).toBe(true);
    expect(isHomeResponse(homeBrowse)).toBe(true);
  });

  it('is false for other responses', () => {
    expect(isHomeResponse(transcript)).toBe(false);
    expect(
      isHomeResponse({
        responseContext: {
          serviceTrackingParams: [{ params: [{ key: 'browse_id', value: 'FEsubscriptions' }] }],
        },
      }),
    ).toBe(false);
  });

  it('finds the Home response in a navigation detail at either depth', () => {
    expect(navResponse({ response: { response: homeBrowse } })).toBe(homeBrowse);
    expect(navResponse({ response: homeBrowse })).toBe(homeBrowse);
    expect(navResponse({ response: { response: transcript } })).toBeNull();
  });
});
