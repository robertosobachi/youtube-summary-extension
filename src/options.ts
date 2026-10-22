import { send } from './messages';
import type { SettingsView } from './messages';

const form = document.querySelector<HTMLFormElement>('#settings')!;
const keyInput = document.querySelector<HTMLInputElement>('#api-key')!;
const langsInput = document.querySelector<HTMLInputElement>('#langs')!;
const testButton = document.querySelector<HTMLButtonElement>('#test')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;

function show(settings: SettingsView): void {
  keyInput.value = '';
  keyInput.placeholder = settings.hasKey ? `Saved key ending in ${settings.keyHint}` : 'sk-ant-...';
  langsInput.value = settings.langs.join(', ');
}

function report(text: string, ok: boolean): void {
  status.textContent = text;
  status.dataset.state = ok ? 'ok' : 'error';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  show(await send('settings/save', { apiKey: keyInput.value, langs: langsInput.value }));
  report('Saved.', true);
});

testButton.addEventListener('click', async () => {
  testButton.disabled = true;
  report('Testing...', true);
  try {
    const result = await send('key/test', { apiKey: keyInput.value });
    if (result.ok) report('Key works.', true);
    else report(result.error, false);
  } finally {
    testButton.disabled = false;
  }
});

send('settings/get', {}).then(show);
