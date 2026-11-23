// The hosted page reloads itself when a newer publication is out. GitHub
// Pages lets a browser keep a page for ten minutes, so a visit right after
// a push could get the previous one. The build stamps its id in a <meta>
// and in version.json ; this compares the two on opening, and again when
// the tab comes back to the front. The local page has no stamp : nothing
// happens there.

const BUILD = document.querySelector('meta[name="convmap-build"]')?.content;
const RELOADED = 'convmap-reloaded';

async function checkBuild() {
  try {
    const response = await fetch('version.json', { cache: 'no-store' });
    if (!response.ok) return;
    const { build } = await response.json();
    // Once per publication : should the browser still serve the old page,
    // it is not reloaded in a loop.
    if (build === BUILD || sessionStorage.getItem(RELOADED) === build) return;
    sessionStorage.setItem(RELOADED, build);
    // Refreshes the browser's copy of the page, which reload() would reuse.
    await fetch(location.pathname, { cache: 'reload' });
    location.reload();
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
