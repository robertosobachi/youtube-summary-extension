// Builds the age filter fixtures from the same private Home captures in fixtures/raw/ as
// sanitise-fixtures.mjs. Keeps the published dates; titles, IDs and channel names become fakes.
// Usage: node scripts/sanitise-age-fixtures.mjs
import fs from 'node:fs';

const HOME_MARKER = {
  serviceTrackingParams: [
    { service: 'GFEEDBACK', params: [{ key: 'browse_id', value: 'FEwhat_to_watch' }] },
  ],
};

const AGO = / ago$/;
const VIEWS = / views$/;
const UNIT_DAYS = { sec: 0, min: 0, hr: 0, day: 1, days: 1, wk: 7, mo: 30, yr: 365 };
const MAX_AGE_DAYS = 180;
const SHORTS_PER_SHELF = 2;

const metadataParts = (lockup) =>
  lockup.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows.flatMap(
    (row) => row.metadataParts,
  );

/** One key per case the tests need; null for items that are not worth keeping. */
function caseKey(item) {
  if (item.continuationItemRenderer) return 'continuation';
  if (item.richSectionRenderer) return 'shelf';
  const content = item.richItemRenderer?.content;
  if (content?.adSlotRenderer) return 'ad';
  if (!content?.lockupViewModel) return null;

  const parts = metadataParts(content.lockupViewModel);
  const channelParts = parts.filter(
    (p) => !AGO.test(p.text?.content ?? '') && !VIEWS.test(p.accessibilityLabel ?? ''),
  );
  if (channelParts.length > 1) return 'multi-channel';

  const date = parts.map((p) => p.text?.content ?? '').find((t) => AGO.test(t));
  const match = date && /(\d+) (\w+) ago$/.exec(date);
  if (!match || !(match[2] in UNIT_DAYS)) return 'unparsed';
  const old = Number(match[1]) * UNIT_DAYS[match[2]] > MAX_AGE_DAYS;
  return `${match[2].replace(/s$/, '')}:${old ? 'old' : 'new'}`;
}

/** Keeps the first item of each case, in feed order. */
function selectCases(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = caseKey(item);
    if (key === null || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitiseItems(rawItems, prefix) {
  const items = selectCases(rawItems);
  let video = 0;
  let shorts = 0;
  return items.map((item) => {
    if (item.continuationItemRenderer) {
      return { continuationItemRenderer: { trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN' } };
    }
    if (item.richSectionRenderer) {
      const contents = item.richSectionRenderer.content?.richShelfRenderer?.contents ?? [];
      return {
        richSectionRenderer: {
          content: {
            richShelfRenderer: {
              contents: contents.slice(0, SHORTS_PER_SHELF).map(() => ({
                richItemRenderer: {
                  content: { shortsLockupViewModel: { entityId: `shorts-${++shorts}` } },
                },
              })),
            },
          },
        },
      };
    }
    const content = item.richItemRenderer?.content;
    if (content?.adSlotRenderer) {
      return {
        richItemRenderer: {
          content: {
            adSlotRenderer: {
              fulfillmentContent: {
                fulfilledLayout: {
                  inFeedAdLayoutRenderer: {
                    renderingContent: {
                      videoDisplayButtonGroupLayoutViewModel: {
                        videoLockup: {
                          lockupViewModel: {
                            contentId: 'adVideo0001',
                            contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }
    const lockup = content?.lockupViewModel;
    if (!lockup) throw new Error(`Unhandled item: ${Object.keys(item).join(', ')}`);

    const n = ++video;
    let channelPart = 0;
    const metadataRows = [
      {
        metadataParts: metadataParts(lockup).map((part) => {
          const text = part.text?.content ?? '';
          const label = part.accessibilityLabel;
          // Dates and view counts are kept verbatim: they are what the tests exercise.
          if (AGO.test(text) || VIEWS.test(label ?? '')) {
            return label
              ? { text: { content: text }, accessibilityLabel: label }
              : { text: { content: text } };
          }
          return {
            text: { content: channelPart++ === 0 ? `Channel ${n}` : `and Channel ${n}b` },
          };
        }),
      },
    ];

    return {
      richItemRenderer: {
        content: {
          lockupViewModel: {
            contentId: `${prefix}${String(n).padStart(11 - prefix.length, '0')}`,
            contentType: lockup.contentType,
            metadata: {
              lockupMetadataViewModel: {
                title: { content: `${prefix} video ${n}` },
                metadata: { contentMetadataViewModel: { metadataRows } },
              },
            },
          },
        },
      },
    };
  });
}

function sanitiseBrowse(raw) {
  const action = raw.onResponseReceivedActions.find((a) => a.appendContinuationItemsAction);
  const { targetId, continuationItems } = action.appendContinuationItemsAction;
  return {
    responseContext: HOME_MARKER,
    onResponseReceivedActions: [
      {
        appendContinuationItemsAction: {
          targetId,
          continuationItems: sanitiseItems(continuationItems, 'brws'),
        },
      },
    ],
  };
}

function sanitiseInitial(raw) {
  const tab = raw.contents.twoColumnBrowseResultsRenderer.tabs.find((t) => t.tabRenderer?.content);
  const grid = tab.tabRenderer.content.richGridRenderer;
  return {
    responseContext: HOME_MARKER,
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: { richGridRenderer: { contents: sanitiseItems(grid.contents, 'init') } },
            },
          },
        ],
      },
    },
  };
}

for (const [name, out, sanitise] of [
  ['home-browse', 'age-browse', sanitiseBrowse],
  ['home-initial', 'age-initial', sanitiseInitial],
]) {
  const raw = JSON.parse(fs.readFileSync(`fixtures/raw/${name}.json`, 'utf8'));
  fs.writeFileSync(`fixtures/${out}.json`, JSON.stringify(sanitise(raw), null, 2) + '\n');
  console.log(`fixtures/${out}.json`);
}
