import { watchUrl } from './youtube';
import type { Summary } from './messages';

/** The CLI's follow-up prompt: self-contained, so it can be pasted into any chat. */
export function chatText(id: string, { title, channel, summary, transcript }: Summary): string {
  return (
    'Below are the summary and transcript of a YouTube video. Answer my questions about it.\n\n' +
    `# ${title} (${channel})\n\n${watchUrl(id)}\n\n## Summary\n\n${summary}\n\n## Transcript\n\n${transcript}\n`
  );
}
