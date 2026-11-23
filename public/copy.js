// Copies a text and says so on the button that was clicked : its label turns
// into a check mark and "Copié" for a moment — the confirmation sits where
// the eye already is.

const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
const SHOWN_MS = 1500;

const CLIPBOARD_WAIT_MS = 400;

async function write(text) {
  // The clipboard call can be refused, missing (a page not served over
  // https) or left waiting on a permission nobody answers : past a short
  // wait, the selection-based copy takes over.
  const clipboard = navigator.clipboard;
  const wrote = clipboard ? clipboard.writeText(text).then(() => true, () => false) : false;
  if (await Promise.race([wrote, new Promise((resolve) => setTimeout(() => resolve(false), CLIPBOARD_WAIT_MS))])) return;
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export async function copyWith(button, text) {
  await write(text);
  if (button.classList.contains('copied')) return;
  const label = button.innerHTML;
  // The button keeps its width while its label changes.
  button.style.minWidth = `${button.offsetWidth}px`;
  button.innerHTML = `${CHECK} Copié`;
  button.classList.add('copied');
  setTimeout(() => {
    button.innerHTML = label;
    button.classList.remove('copied');
    button.style.minWidth = '';
  }, SHOWN_MS);
}
