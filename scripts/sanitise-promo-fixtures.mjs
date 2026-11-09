// Builds the promo and collection filter fixture from a private Home capture in fixtures/raw/
// holding YouTube featured promos and a Mix. Keeps each grid item's renderer keys in feed
// order; promo videos, titles, IDs and channel names become fakes or are dropped.
// Usage: node scripts/sanitise-promo-fixtures.mjs
import fs from 'node:fs';

const HOME_MARKER = {
  serviceTrackingParams: [
    { service: 'GFEEDBACK', params: [{ key: 'browse_id', value: 'FEwhat_to_watch' }] },
  ],
};
const VIDEOS = 3;

const text = (runs) => runs?.map((run) => run.text).join('') ?? '';

function sanitiseSection(section, index) {
  const { brandVideoShelfRenderer: shelf, brandVideoSingletonRenderer: single } = section.content;
  if (shelf) {
    const header = shelf.header.sectionHeaderViewModel;
    return {
      brandVideoShelfRenderer: {
        header: {
          sectionHeaderViewModel: {
            headline: { content: header.headline.content },
            bottomBadges: header.bottomBadges.map(
              ({ badgeViewModel: { badgeText, badgeStyle } }) => ({
                badgeViewModel: { badgeText, badgeStyle },
              }),
            ),
          },
        },
        subtitle: { runs: [{ text: text(shelf.subtitle.runs) }] },
        content: shelf.content.slice(0, 2).map((_, n) => ({
          videoRenderer: { videoId: `prom${String(index * 10 + n).padStart(7, '0')}` },
        })),
      },
    };
  }
  if (single) {
    return {
      brandVideoSingletonRenderer: {
        title: { runs: [{ text: 'Featured promo' }] },
        badgeText: single.badgeText,
        content: { videoRenderer: { videoId: `prom${String(index * 10).padStart(7, '0')}` } },
      },
    };
  }
  throw new Error(`Unhandled section: ${Object.keys(section.content).join(', ')}`);
}

function sanitiseItems(rawItems) {
  let videos = 0;
  let collections = 0;
  return rawItems.flatMap((item, index) => {
    if (item.continuationItemRenderer) {
      return [{ continuationItemRenderer: { trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN' } }];
    }
    if (item.richSectionRenderer) {
      return [
        { richSectionRenderer: { content: sanitiseSection(item.richSectionRenderer, index) } },
      ];
    }
    const content = item.richItemRenderer?.content;
    if (content?.adSlotRenderer) return [{ richItemRenderer: { content: { adSlotRenderer: {} } } }];
    // The first collection, such as a Mix, whatever its position: only its stacked thumbnail
    // marker is kept.
    if (content?.lockupViewModel?.contentImage?.collectionThumbnailViewModel) {
      if (collections++) return [];
      return [
        {
          richItemRenderer: {
            content: {
              lockupViewModel: {
                contentId: 'RDfakemix0001',
                contentType: content.lockupViewModel.contentType,
                contentImage: { collectionThumbnailViewModel: {} },
              },
            },
          },
        },
      ];
    }
    if (!content?.lockupViewModel || videos >= VIDEOS) return [];
    const n = ++videos;
    return [
      {
        richItemRenderer: {
          content: {
            lockupViewModel: {
              contentId: `prmv${String(n).padStart(7, '0')}`,
              contentType: content.lockupViewModel.contentType,
            },
          },
        },
      },
    ];
  });
}

const raw = JSON.parse(fs.readFileSync('fixtures/raw/home-memberships-browse.json', 'utf8'));
const tab = raw.contents.twoColumnBrowseResultsRenderer.tabs.find((t) => t.tabRenderer?.content);
const fixture = {
  responseContext: HOME_MARKER,
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            selected: true,
            content: {
              richGridRenderer: {
                contents: sanitiseItems(tab.tabRenderer.content.richGridRenderer.contents),
              },
            },
          },
        },
      ],
    },
  },
};
fs.writeFileSync('fixtures/promo-initial.json', JSON.stringify(fixture, null, 2) + '\n');
console.log('fixtures/promo-initial.json');
