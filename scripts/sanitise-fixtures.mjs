// Builds committable fixtures from private captures in fixtures/raw/.
// Keeps only the structure the code reads; text, ids and tracking values become fakes.
// Usage: node scripts/sanitise-fixtures.mjs
import fs from 'node:fs';

const SEGMENTS_PER_SECTION = 3;
const SECTIONS = 2;

const HOME_LOCKUPS = 3;
const BROWSE_LOCKUPS = 2;
// Raw strings allowed into the fixtures: constants the code matches on.
const ALLOWED = new Set([
  'HIDE',
  'REMOVE',
  'LOCKUP_CONTENT_TYPE_VIDEO',
  'FEwhat_to_watch',
  'browse_id',
  'Not interested',
  "Don't recommend channel",
]);
const LABELS = { HIDE: 'Not interested', REMOVE: "Don't recommend channel" };
const fakeId = (n) => `fakeVideo${String(n).padStart(2, '0')}`;

/** get_panel transcript: two chapter sections of three segments, all text replaced. */
function sanitiseTranscript(raw) {
  const sections =
    raw.content.engagementPanelSectionListRenderer.content.sectionListRenderer.contents;
  let segment = 0;
  return {
    content: {
      engagementPanelSectionListRenderer: {
        content: {
          sectionListRenderer: {
            contents: sections.slice(0, SECTIONS).map((section, n) => {
              const { header, contents } = section.itemSectionRenderer;
              const chapter = header.macroMarkersPanelItemViewModel.item.timelineChapterViewModel;
              return {
                itemSectionRenderer: {
                  header: {
                    macroMarkersPanelItemViewModel: {
                      item: {
                        timelineChapterViewModel: {
                          title: `Chapter ${n + 1}`,
                          index: chapter.index,
                        },
                      },
                    },
                  },
                  contents: contents.slice(0, SEGMENTS_PER_SECTION).map((item) => {
                    const timeline = item.macroMarkersPanelItemViewModel.item.timelineItemViewModel;
                    return {
                      macroMarkersPanelItemViewModel: {
                        item: {
                          timelineItemViewModel: {
                            timestamp: timeline.timestamp,
                            contentItems: timeline.contentItems.map((c) => ({
                              transcriptSegmentViewModel: {
                                simpleText: `Segment ${++segment}`,
                                timestamp: c.transcriptSegmentViewModel.timestamp,
                              },
                            })),
                          },
                        },
                      },
                    };
                  }),
                },
              };
            }),
          },
        },
      },
    },
  };
}

/** Only the Home marker: one browse_id param, read from the raw response. */
function homeContext(raw) {
  const home = raw.responseContext.serviceTrackingParams.some((service) =>
    service.params.some((p) => p.key === 'browse_id' && p.value === 'FEwhat_to_watch'),
  );
  if (!home) throw new Error('raw capture is not a Home response');
  return {
    serviceTrackingParams: [{ params: [{ key: 'browse_id', value: 'FEwhat_to_watch' }] }],
  };
}

/** Video lockups in document order, ads (no content type) and Shorts left out. */
function videoLockups(items) {
  return items
    .map((item) => item.richItemRenderer?.content?.lockupViewModel)
    .filter((lockup) => lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO');
}

/**
 * A lockup rebuilt from scratch. From the raw it keeps the content type and its HIDE and
 * REMOVE menu items, in order; every value is fake. `stripIcon` drops the HIDE icon so only
 * the English label is left.
 */
function sanitiseLockup(lockup, n, stripIcon = false) {
  const id = fakeId(n);
  const meta = lockup.metadata.lockupMetadataViewModel;
  const items =
    meta.menuButton.buttonViewModel.onTap.innertubeCommand.showSheetCommand.panelLoadingStrategy
      .inlineContent.sheetViewModel.content.listViewModel.listItems;
  const listItems = items.flatMap((item) => {
    const icon = item.listItemViewModel?.leadingImage?.sources?.[0]?.clientResource?.imageName;
    if (icon !== 'HIDE' && icon !== 'REMOVE') return [];
    const hidden = stripIcon && icon === 'HIDE';
    return [
      {
        listItemViewModel: {
          title: { content: LABELS[icon] },
          ...(hidden
            ? {}
            : { leadingImage: { sources: [{ clientResource: { imageName: icon } }] } }),
          rendererContext: {
            commandContext: {
              onTap: {
                innertubeCommand: {
                  commandMetadata: { webCommandMetadata: { sendPost: true } },
                  feedbackEndpoint: { feedbackToken: `${icon === 'HIDE' ? 'ni' : 'rm'}-${id}` },
                },
              },
            },
          },
        },
      },
    ];
  });
  if (listItems.length !== 2) throw new Error(`lockup ${n}: expected HIDE and REMOVE items`);
  return {
    lockupViewModel: {
      contentId: id,
      contentType: lockup.contentType,
      metadata: {
        lockupMetadataViewModel: {
          title: { content: `Video ${n}` },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [{ metadataParts: [{ text: { content: `Channel ${n}` } }] }],
            },
          },
          menuButton: {
            buttonViewModel: {
              onTap: {
                innertubeCommand: {
                  showSheetCommand: {
                    panelLoadingStrategy: {
                      inlineContent: {
                        sheetViewModel: { content: { listViewModel: { listItems } } },
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

/** One Short with a video id a careless walker might pick up. */
const SHORT = {
  richSectionRenderer: {
    content: {
      richShelfRenderer: {
        contents: [
          {
            richItemRenderer: {
              content: {
                shortsLockupViewModel: {
                  onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'fakeShort01' } } },
                },
              },
            },
          },
        ],
      },
    },
  },
};

/** ytInitialData on a hard load of Home: lockups in the grid, the last one label-only. */
function sanitiseHomeInitial(raw) {
  const grid =
    raw.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer;
  const lockups = videoLockups(grid.contents).slice(0, HOME_LOCKUPS);
  return {
    responseContext: homeContext(raw),
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                richGridRenderer: {
                  contents: [
                    ...lockups.map((lockup, i) => ({
                      richItemRenderer: {
                        content: sanitiseLockup(lockup, i + 1, i === HOME_LOCKUPS - 1),
                      },
                    })),
                    SHORT,
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
}

/** A /youtubei/v1/browse continuation of Home. */
function sanitiseHomeBrowse(raw) {
  const items = raw.onResponseReceivedActions.flatMap(
    (action) => action.appendContinuationItemsAction?.continuationItems ?? [],
  );
  const lockups = videoLockups(items).slice(0, BROWSE_LOCKUPS);
  return {
    responseContext: homeContext(raw),
    onResponseReceivedActions: [
      {
        appendContinuationItemsAction: {
          continuationItems: lockups.map((lockup, i) => ({
            richItemRenderer: { content: sanitiseLockup(lockup, HOME_LOCKUPS + i + 1) },
          })),
        },
      },
    ],
  };
}

/** Every string value in a JSON tree, with its path. Keys are not included. */
function strings(node, path = '$', out = []) {
  if (typeof node === 'string') out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((item, i) => strings(item, `${path}[${i}]`, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) strings(value, `${path}.${key}`, out);
  }
  return out;
}

const outputs = [];
const rawStrings = new Set();
for (const [name, sanitise] of [
  ['transcript', sanitiseTranscript],
  ['home-initial', sanitiseHomeInitial],
  ['home-browse', sanitiseHomeBrowse],
]) {
  const raw = JSON.parse(fs.readFileSync(`fixtures/raw/${name}.json`, 'utf8'));
  for (const [, value] of strings(raw)) if (value.length > 6) rawStrings.add(value);
  outputs.push([`fixtures/${name}.json`, sanitise(raw)]);
}

// Last line of defence before anything is written: no raw value longer than 6 characters
// reaches a committed file, apart from the constants the code matches on.
const leaks = outputs.flatMap(([file, data]) =>
  strings(data)
    .filter(([, value]) => rawStrings.has(value) && !ALLOWED.has(value))
    .map(([path]) => `${file} ${path}`),
);
if (leaks.length) {
  console.error(`Raw strings survived:\n${leaks.join('\n')}`);
  process.exit(1);
}

for (const [file, data] of outputs) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(file);
}
