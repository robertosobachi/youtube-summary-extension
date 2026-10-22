// Builds committable fixtures from private captures in fixtures/raw/.
// Keeps only the structure the code reads; text, ids and tracking values become fakes.
// Usage: node scripts/sanitise-fixtures.mjs
import fs from 'node:fs';

const SEGMENTS_PER_SECTION = 3;
const SECTIONS = 2;

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

for (const [name, sanitise] of [['transcript', sanitiseTranscript]]) {
  const raw = JSON.parse(fs.readFileSync(`fixtures/raw/${name}.json`, 'utf8'));
  fs.writeFileSync(`fixtures/${name}.json`, JSON.stringify(sanitise(raw), null, 2) + '\n');
  console.log(`fixtures/${name}.json`);
}
