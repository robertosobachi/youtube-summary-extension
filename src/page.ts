// MAIN world, document_start. Reads YouTube's own page data and passes the public parts to
// content.ts with postMessage. Never sees the API key or storage.
import { CONTENT_SOURCE, PAGE_SOURCE, isFrom, post } from './messages';
import { watchVideo } from './youtube';
import type { ContentMessage } from './messages';
import type { InnertubeConfig } from './youtube';

type Ytcfg = { get(key: string): unknown };

function innertubeConfig(): InnertubeConfig | null {
  const ytcfg = (window as unknown as { ytcfg?: Ytcfg }).ytcfg;
  const context = ytcfg?.get('INNERTUBE_CONTEXT');
  const clientName = ytcfg?.get('INNERTUBE_CONTEXT_CLIENT_NAME');
  const clientVersion = ytcfg?.get('INNERTUBE_CLIENT_VERSION');
  if (!context || clientName == null || typeof clientVersion !== 'string') return null;
  return { context, clientName: String(clientName), clientVersion };
}

window.addEventListener('message', (event) => {
  if (!isFrom<ContentMessage>(event, CONTENT_SOURCE)) return;
  if (event.data.type === 'cfg?') {
    post(PAGE_SOURCE, { type: 'cfg', nonce: event.data.nonce, cfg: innertubeConfig() });
  }
});

document.addEventListener('yt-navigate-finish', (event) => {
  const detail = (event as CustomEvent).detail;
  post(PAGE_SOURCE, {
    type: 'nav',
    pageType: String(detail?.pageType ?? ''),
    video: watchVideo(detail),
  });
});
