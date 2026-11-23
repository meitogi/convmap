// The access page of the hosted site : one link per person, added and
// revoked from here. The list lives in the repository, sealed with the
// master key ; saving it is a commit, which republishes the site.

import { accessLink, addPerson, readAccess, removePerson, sealAccess } from './lib/access.mjs';
import { copyWith } from './copy.js';
import { fromBase64Url, toBase64Url } from './lib/crypto.mjs';

const API = 'https://api.github.com';
const FILE = 'snapshot/access.bin';
const WORKFLOW = 'pages.yml';
const SETTINGS = 'convmap-admin';
const KEY_STORE = 'convmap-key';
const $ = (id) => document.getElementById(id);
const settings = $('settings').elements;
// The page the links open : this page's folder.
const base = location.origin + location.pathname.replace(/[^/]*$/, '');

let list = [];
// The file's current version on GitHub ; null while it does not exist.
let sha = null;

function showStatus(text) {
  const status = $('status');
  status.hidden = !text;
  status.textContent = text;
}

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) Object.assign(node, props);
  node.append(...children);
  return node;
}

// One call to GitHub's API on this repository. path : what follows
// /repos/<repository>/. Returns the answer, or null when there is none.
async function githubCall(method, path, body) {
  const response = await fetch(`${API}/repos/${settings.repo.value.trim()}/${path}`, {
    method,
    headers: { authorization: `Bearer ${settings.token.value.trim()}`, accept: 'application/vnd.github+json' },
    body: body && JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) throw new Error('GitHub refuse le jeton : vérifie qu\'il est valide et qu\'il a les permissions Contents et Actions en écriture sur ce dépôt.');
  if (response.status === 404 && method === 'GET') return null;
  if (response.status === 404) throw new Error('Introuvable avec ce jeton : vérifie le nom du dépôt et les permissions du jeton.');
  if (response.status === 409) throw new Error('La liste a changé entre-temps : recharge-la puis recommence.');
  if (!response.ok) throw new Error(`GitHub a répondu ${response.status}.`);
  return response.status === 204 ? null : response.json();
}

// Who signs the commits this page makes : the token's account, under its
// GitHub no-reply address. Left to itself GitHub signs them with the
// account's own e-mail, which a public repository would then show.
let signature = null;

async function signer() {
  if (signature) return signature;
  const response = await fetch(`${API}/user`, { headers: { authorization: `Bearer ${settings.token.value.trim()}`, accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error('GitHub refuse le jeton : impossible de lire le compte auquel il appartient.');
  const { id, login } = await response.json();
  signature = { name: login, email: `${id}+${login}@users.noreply.github.com` };
  return signature;
}

// The access list's file.
const github = (method, body) => githubCall(method, `contents/${FILE}`, body);

function render() {
  const master = settings.key.value.trim();
  const rows = [{ name: 'Toi (clé maître)', created: '', key: master, master: true }].concat(list);
  $('people').replaceChildren(
    ...rows.map((person) => {
      const link = el('input', { readOnly: true, value: accessLink(base, person.key) });
      const copy = el('button', { type: 'button' }, 'Copier');
      copy.dataset.copy = link.value;
      const actions = el('td', null, copy);
      if (!person.master) {
        const revoke = el('button', { type: 'button', className: 'danger' }, 'Révoquer');
        revoke.dataset.revoke = person.name;
        actions.append(' ', revoke);
      }
      return el('tr', null, el('td', null, person.name), el('td', null, person.created), el('td', null, link), actions);
    }),
  );
  $('access').hidden = false;
  $('data').hidden = false;
}

async function loadList() {
  showStatus('Chargement de la liste…');
  $('access').hidden = true;
  $('data').hidden = true;
  try {
    const file = await github('GET');
    sha = file ? file.sha : null;
    // GitHub wraps its base64 in line breaks.
    const bytes = file ? fromBase64Url(file.content.replace(/\s/g, '')) : null;
    try {
      list = await readAccess(bytes, settings.key.value.trim());
    } catch {
      throw new Error('La clé maître ne correspond pas à la liste enregistrée dans le dépôt.');
    }
    render();
    showStatus(file ? '' : 'Aucun lien personnel pour l\'instant : seul le lien de la clé maître ouvre la page.');
  } catch (error) {
    showStatus(error.message);
  }
}

// Commits the list ; on failure the list shown stays the one GitHub has.
async function saveList(next, message, done) {
  showStatus('Enregistrement…');
  try {
    const sealed = await sealAccess(next, settings.key.value.trim());
    // GitHub wants standard base64, with its padding.
    const content = toBase64Url(sealed).replace(/-/g, '+').replace(/_/g, '/');
    const who = await signer();
    const body = { message, content: content + '='.repeat((4 - (content.length % 4)) % 4), author: who, committer: who };
    if (sha) body.sha = sha;
    const result = await github('PUT', body);
    sha = result.content.sha;
    list = next;
    render();
    showStatus(`${done} La page est republiée dans une à deux minutes.`);
  } catch (error) {
    showStatus(error.message);
  }
}

$('settings').addEventListener('submit', (event) => {
  event.preventDefault();
  // Another token may belong to another account.
  signature = null;
  try {
    localStorage.setItem(SETTINGS, JSON.stringify({ repo: settings.repo.value.trim(), token: settings.token.value.trim() }));
    localStorage.setItem(KEY_STORE, settings.key.value.trim());
  } catch {
    // Private window : the settings last for this visit.
  }
  loadList();
});

$('forget').addEventListener('click', () => {
  try {
    localStorage.removeItem(SETTINGS);
    localStorage.removeItem(KEY_STORE);
  } catch {
    // Nothing was kept.
  }
  $('settings').reset();
  $('access').hidden = true;
  $('data').hidden = true;
  showStatus('Réglages oubliés sur ce navigateur.');
});

// Runs the publication workflow now instead of waiting for Monday : it
// re-reads the agenda, refreshes the snapshot and republishes the site.
$('refresh').addEventListener('click', async () => {
  const button = $('refresh');
  button.disabled = true;
  showStatus('Demande envoyée à GitHub…');
  try {
    await githubCall('POST', `actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main' });
    showStatus('Mise à jour lancée : GitHub relit l\'agenda puis republie le site, compter 4 à 6 minutes. Le suivi est dans l\'onglet Actions du dépôt.');
  } catch (error) {
    showStatus(error.message);
  }
  button.disabled = false;
});

$('add').addEventListener('submit', (event) => {
  event.preventDefault();
  const field = event.target.elements.name;
  const name = field.value.trim();
  let next;
  try {
    next = addPerson(list, name, new Date().toISOString().slice(0, 10));
  } catch {
    return showStatus(`« ${name} » a déjà un lien.`);
  }
  field.value = '';
  saveList(next, 'Add an access link', `Lien créé pour ${name}.`);
});

$('people').addEventListener('click', async (event) => {
  const { copy, revoke } = event.target.dataset;
  if (copy) {
    copyWith(event.target, copy);
  } else if (revoke && confirm(`Révoquer le lien de ${revoke} ?`)) {
    saveList(removePerson(list, revoke), 'Revoke an access link', `Lien de ${revoke} révoqué.`);
  }
});

// Settings : what this browser kept, the key of the link used to come here,
// and the repository this page is served from.
let kept = {};
try {
  kept = JSON.parse(localStorage.getItem(SETTINGS)) || {};
  // As on the main page : a key that came with the link is kept and taken out
  // of the address bar.
  const fromLink = (/[#&]k=([\w-]+)/.exec(location.hash) || [])[1];
  if (fromLink) {
    localStorage.setItem(KEY_STORE, fromLink);
    history.replaceState(null, '', location.pathname + location.search);
  }
  settings.key.value = fromLink || localStorage.getItem(KEY_STORE) || '';
} catch {
  // Private window.
}
const pages = /^([\w-]+)\.github\.io$/.exec(location.hostname);
settings.repo.value = kept.repo || (pages ? `${pages[1]}/${location.pathname.split('/')[1]}` : '');
settings.token.value = kept.token || '';
if (settings.repo.value && settings.token.value && settings.key.value) loadList();
