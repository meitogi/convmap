// The hosted page says when a newer publication is out. GitHub Pages lets a
// browser keep a page for ten minutes, so a visit right after a push could
// get the previous one. The build stamps its id in a <meta> and in
// version.json ; this compares the two on opening, and again when the tab
// comes back to the front, and offers a toast that reloads on a click. The
// local page has no stamp : nothing happens there.

const BUILD = document.querySelector('meta[name="convmap-build"]')?.content;
let toast = null;

async function reload() {
  // Refreshes the browser's copy of the page, which reload() would reuse.
  try {
    await fetch(location.pathname, { cache: 'reload' });
  } catch {
    // Offline : reload() shows what the browser has.
  }
  location.reload();
}

function showToast() {
  if (toast) return;
  toast = document.createElement('div');
  toast.className = 'fresh-toast';
  toast.setAttribute('role', 'status');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'fresh-reload';
  const action = document.createElement('strong');
  action.textContent = 'Recharger';
  open.append('Nouvelle version en ligne', action);
  open.addEventListener('click', reload);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'fresh-close';
  close.ariaLabel = 'Plus tard';
  close.title = 'Plus tard';
  close.textContent = '×';
  close.addEventListener('click', () => toast.remove());
  toast.append(open, close);
  document.body.append(toast);
}

async function checkBuild() {
  try {
    const response = await fetch('version.json', { cache: 'no-store' });
    if (!response.ok) return;
    const { build } = await response.json();
    if (build !== BUILD) showToast();
  } catch {
    // Offline : the page stays as it is.
  }
}

if (BUILD) {
  checkBuild();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkBuild();
  });
}
