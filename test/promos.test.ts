import { describe, expect, it } from 'vitest';
import ageFixture from '../fixtures/age-initial.json';
import promoFixture from '../fixtures/promo-initial.json';
import { isPromoSection, removeOldVideos, removePromos } from '../src/youtube';

// Tests walk deep into fixture JSON; typing every step would add nothing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const promo = (): Json => structuredClone(promoFixture as Json);
const items = (d: Json): Json[] =>
  d.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;
const kinds = (d: Json): string[] =>
  items(d).map(
    (i) => Object.keys(i.richItemRenderer?.content ?? i.richSectionRenderer?.content ?? i)[0],
  );

describe('isPromoSection', () => {
  it('matches the memberships shelf and the singleton promo', () => {
    const sections = items(promo()).filter(isPromoSection);
    expect(sections.map((s) => Object.keys(s.richSectionRenderer.content)[0])).toEqual([
      'brandVideoShelfRenderer',
      'brandVideoSingletonRenderer',
    ]);
  });

  it('leaves the Shorts shelf alone', () => {
    expect(items(structuredClone(ageFixture as Json)).filter(isPromoSection)).toHaveLength(0);
  });
});

describe('removePromos', () => {
  it('removes both promos and keeps everything else in order', () => {
    const data = promo();
    const before = kinds(data);
    expect(removePromos(data)).toBe(2);
    expect(kinds(data)).toEqual(
      before.filter((k) => k !== 'brandVideoShelfRenderer' && k !== 'brandVideoSingletonRenderer'),
    );
    expect(items(data).at(-1)).toHaveProperty('continuationItemRenderer');
  });

  it('changes nothing without promos', () => {
    const data = structuredClone(ageFixture as Json);
    expect(removePromos(data)).toBe(0);
    expect(data).toEqual(ageFixture);
  });

  it('runs alongside the age cut-off', () => {
    const data = structuredClone(ageFixture as Json);
    removeOldVideos(data, 180);
    const filtered = structuredClone(data);
    expect(removePromos(data)).toBe(0);
    expect(data).toEqual(filtered);
  });
});
