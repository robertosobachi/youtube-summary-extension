import { LANGS, MAX_AGE_OPTIONS, send } from './messages';
import type { SettingsView } from './messages';

// Framed in the YouTube drawer, which has its own heading. In its own tab, it asks to move
// there, and stays a page when no YouTube tab can take it.
if (window.top !== window) document.documentElement.classList.add('embedded');
else {
  document.documentElement.classList.add('handing-off');
  send('settings/drawer', {})
    .then((result) => {
      if (!result.ok) document.documentElement.classList.remove('handing-off');
    })
    .catch(() => document.documentElement.classList.remove('handing-off'));
}

// In the YouTube drawer: YouTube's theme, not the system's.
const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

const form = document.querySelector<HTMLFormElement>('#settings')!;
const keyInput = document.querySelector<HTMLInputElement>('#api-key')!;
const langsList = document.querySelector<HTMLDivElement>('#langs .list')!;
const maxAgeSelect = document.querySelector<HTMLSelectElement>('#max-age')!;
const hidePromosBox = document.querySelector<HTMLInputElement>('#hide-promos')!;
const testButton = document.querySelector<HTMLButtonElement>('#test')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;

function show(settings: SettingsView): void {
  keyInput.value = '';
  keyInput.placeholder = settings.hasKey ? `Saved key ending in ${settings.keyHint}` : 'sk-ant-...';
  showLangs(settings.langs);
  maxAgeSelect.value = String(settings.maxAgeDays);
  savedMaxAge = settings.maxAgeDays;
  hidePromosBox.checked = settings.hidePromos;
}

// To say when a reload is needed: the cut-off only reaches responses loaded after saving.
let savedMaxAge: number | null = null;

for (const { label, days } of MAX_AGE_OPTIONS) maxAgeSelect.add(new Option(label, String(days)));

const langName = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });

/** One checkbox per offered language, plus any saved code the list no longer offers. */
function showLangs(saved: string[]): void {
  const codes = [...new Set([...LANGS, ...saved])];
  const named = codes.map((code) => ({ code, name: nameOf(code) }));
  named.sort((a, b) => a.name.localeCompare(b.name));
  langsList.replaceChildren(
    ...named.map(({ code, name }) => {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = code;
      box.checked = saved.includes(code);
      const label = document.createElement('label');
      label.append(box, name);
      return label;
    }),
  );
}

// A malformed saved code would make DisplayNames throw.
function nameOf(code: string): string {
  try {
    return langName.of(code) ?? code;
  } catch {
    return code;
  }
}

function checkedLangs(): string[] {
  return [...langsList.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.value);
}

function report(text: string, ok: boolean): void {
  status.textContent = text;
  status.dataset.state = ok ? 'ok' : 'error';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const maxAgeDays = Number(maxAgeSelect.value);
  const ageChanged = maxAgeDays !== savedMaxAge;
  show(await send('settings/save', { apiKey: keyInput.value, langs: checkedLangs(), maxAgeDays }));
  report(ageChanged ? 'Saved. Reload YouTube to refilter videos already shown.' : 'Saved.', true);
});

// Saved on its own, without Save: open YouTube tabs apply it at once.
hidePromosBox.addEventListener('change', async () => {
  const { hidePromos } = await send('promos/save', { hidePromos: hidePromosBox.checked });
  hidePromosBox.checked = hidePromos;
  report(
    hidePromos ? 'Promos hidden.' : 'Promos shown. Reload YouTube for any filtered out.',
    true,
  );
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
