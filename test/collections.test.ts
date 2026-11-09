import { describe, expect, it } from 'vitest';
import ageFixture from '../fixtures/age-initial.json';
import promoFixture from '../fixtures/promo-initial.json';
import { isCollection, isPromoSection, removeCollections, removePromos } from '../src/youtube';

// Tests walk deep into fixture JSON; typing every step would add nothing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const promo = (): Json => structuredClone(promoFixture as Json);
const items = (d: Json): Json[] =>
  d.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;
const lockupIds = (d: Json): string[] =>
  items(d).flatMap((i) => i.richItemRenderer?.content?.lockupViewModel?.contentId ?? []);

describe('isCollection', () => {
  it('matches the Mix and no video', () => {
    const collections = items(promo()).filter(isCollection);
    expect(collections.map((c) => c.richItemRenderer.content.lockupViewModel.contentId)).toEqual([
      'RDfakemix0001',
    ]);
  });

  it('matches nothing in a feed without collections', () => {
    expect(items(structuredClone(ageFixture as Json)).filter(isCollection)).toHaveLength(0);
  });
});

describe('removeCollections', () => {
  it('removes the Mix and keeps everything else in order', () => {
    const data = promo();
    const before = items(data).slice();
    expect(removeCollections(data)).toBe(1);
    expect(items(data)).toEqual(before.filter((i) => !isCollection(i)));
    expect(lockupIds(data)).not.toContain('RDfakemix0001');
    expect(items(data).at(-1)).toHaveProperty('continuationItemRenderer');
  });

  it('changes nothing without collections', () => {
    const data = structuredClone(ageFixture as Json);
    expect(removeCollections(data)).toBe(0);
    expect(data).toEqual(ageFixture);
  });

  it('leaves promos alone', () => {
    const data = promo();
    removeCollections(data);
    expect(items(data).filter(isPromoSection)).toHaveLength(2);
  });

  it('is left alone by the promo filter', () => {
    const data = promo();
    removePromos(data);
    expect(lockupIds(data)).toContain('RDfakemix0001');
  });
});
