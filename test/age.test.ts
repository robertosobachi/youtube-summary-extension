import { describe, expect, it } from 'vitest';
import browseFixture from '../fixtures/age-browse.json';
import initialFixture from '../fixtures/age-initial.json';
import { parseAgeDays, removeOldVideos, videoAgeDays } from '../src/youtube';

// Tests walk deep into fixture JSON; typing every step would add nothing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const browse = (): Json => structuredClone(browseFixture as Json);
const initial = (): Json => structuredClone(initialFixture as Json);

const browseItems = (d: Json): Json[] =>
  d.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;
const initialItems = (d: Json): Json[] =>
  d.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;

const lockups = (items: Json[]): Json[] =>
  items
    .map((i) => i.richItemRenderer?.content?.lockupViewModel)
    .filter((l) => l?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO');
const ids = (items: Json[]): string[] => lockups(items).map((l) => l.contentId);
const countKey = (items: Json[], key: string) => items.filter((i) => key in i).length;

describe('parseAgeDays', () => {
  it.each([
    ['3 weeks ago', 21],
    ['1 year ago', 365],
    ['Streamed 2 days ago', 2],
    ['Premiered 3 weeks ago', 21],
    ['6 months ago', 180],
    ['7 months ago', 210],
    ['1 day ago', 1],
  ])('parses full form %j', (text, days) => {
    expect(parseAgeDays(text)).toBe(days);
  });

  it.each([
    ['3 wk ago', 21],
    ['1 mo ago', 30],
    ['10 yr ago', 3650],
    ['13 days ago', 13],
    ['Streamed 2 yr ago', 730],
  ])('parses abbreviated form %j', (text, days) => {
    expect(parseAgeDays(text)).toBe(days);
  });

  it.each([
    '1 hour ago',
    '4 hr ago',
    '45 minutes ago',
    '5 min ago',
    '30 seconds ago',
    '10 sec ago',
  ])('parses sub-day %j as less than one day', (text) => {
    const days = parseAgeDays(text);
    expect(days).not.toBeNull();
    expect(days).toBeLessThan(1);
  });

  it.each(['', 'LIVE', '7.5k', '1.5 thousand views', 'Scheduled for 10/20/26', '3 週間前', 'ago'])(
    'returns null for %j',
    (text) => {
      expect(parseAgeDays(text)).toBeNull();
    },
  );
});

describe('videoAgeDays', () => {
  it('reads a date for every video in the continuation fixture', () => {
    const ages = lockups(browseItems(browse())).map(videoAgeDays);
    expect(ages).toHaveLength(6);
    for (const age of ages) expect(age).not.toBeNull();
  });

  it('prefers the full accessibility label', () => {
    const [first] = lockups(browseItems(browse()));
    expect(videoAgeDays(first)).toBe(4 / 24);
  });

  it('finds the date when the channel spans two parts', () => {
    const sixth = lockups(browseItems(browse())).find((l) => l.contentId === 'brws0000006');
    expect(videoAgeDays(sixth)).toBe(6);
  });
});

describe('removeOldVideos with 180 days', () => {
  it('removes only old videos from a continuation', () => {
    const data = browse();
    expect(removeOldVideos(data, 180)).toEqual({ removed: 1, total: 6 });
    const items = browseItems(data);
    expect(ids(items)).not.toContain('brws0000002');
    for (const lockup of lockups(items)) expect(videoAgeDays(lockup)).toBeLessThanOrEqual(180);
  });

  it('keeps the continuation item last in a continuation', () => {
    const data = browse();
    removeOldVideos(data, 180);
    const items = browseItems(data);
    expect(countKey(items, 'continuationItemRenderer')).toBe(1);
    expect(items.at(-1)).toHaveProperty('continuationItemRenderer');
  });

  it('removes only old videos from initial data and leaves everything else', () => {
    const data = initial();
    const before = initialItems(data).length;
    expect(removeOldVideos(data, 180)).toEqual({ removed: 2, total: 7 });
    const items = initialItems(data);

    expect(items).toHaveLength(before - 2);
    expect(countKey(items, 'continuationItemRenderer')).toBe(1);
    expect(items.at(-1)).toHaveProperty('continuationItemRenderer');
    expect(countKey(items, 'richSectionRenderer')).toBe(1);
    expect(items.filter((i) => i.richItemRenderer?.content.adSlotRenderer)).toHaveLength(1);
    expect(ids(items)).not.toContain('init0000002');
    expect(ids(items)).not.toContain('init0000007');
  });

  it('changes nothing when every video is recent enough', () => {
    const data = initial();
    expect(removeOldVideos(data, 100_000)).toEqual({ removed: 0, total: 7 });
    expect(data).toEqual(initialFixture);
  });

  it('keeps videos whose age cannot be read', () => {
    const data = browse();
    const part =
      browseItems(data)[1].richItemRenderer.content.lockupViewModel.metadata.lockupMetadataViewModel
        .metadata.contentMetadataViewModel.metadataRows[0].metadataParts[2];
    part.text.content = 'LIVE';
    delete part.accessibilityLabel;
    expect(removeOldVideos(data, 180)).toEqual({ removed: 0, total: 6 });
  });
});
