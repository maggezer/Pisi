const DB_NAME = 'kedi-mobile';
const SETTINGS = 'settings';
const MISSIONS_KEY = 'mobileMissions';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('İşlem iptal edildi.'));
  });
}

async function openDatabase() {
  return requestToPromise(indexedDB.open(DB_NAME));
}

async function loadMissions() {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS, 'readonly');
  const row = await requestToPromise(transaction.objectStore(SETTINGS).get(MISSIONS_KEY));
  await transactionDone(transaction);
  return Array.isArray(row?.value) ? row.value : [];
}

async function saveMissions(missions) {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS, 'readwrite');
  transaction.objectStore(SETTINGS).put({ key: MISSIONS_KEY, value: missions });
  await transactionDone(transaction);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function renderMissionOverlay() {
  document.querySelector('#pisi-missions-overlay')?.remove();
  const missions = await loadMissions();
  const openCount = missions.filter((mission) => !mission.done).length;
  document.body.insertAdjacentHTML('beforeend', `
    <section id="pisi-missions-overlay" class="pisi-missions-overlay" role="dialog" aria-modal="true" aria-label="Görevler">
      <header>
        <button type="button" id="pisi-missions-close" aria-label="Kapat">‹</button>
        <div><small>Pisi</small><h1>Görevler</h1></div>
        <span>${openCount} açık</span>
      </header>
      <form id="pisi-mission-form">
        <input id="pisi-mission-input" maxlength="120" placeholder="Yeni görev yaz" autocomplete="off" />
        <button type="submit">Ekle</button>
      </form>
      <main>
        ${missions.length ? missions.map((mission) => `
          <article class="pisi-mission ${mission.done ? 'done' : ''}" data-mission-id="${mission.id}">
            <button type="button" class="pisi-mission-toggle" aria-label="Tamamlandı">${mission.done ? '✓' : ''}</button>
            <span>${escapeHtml(mission.text)}</span>
            <button type="button" class="pisi-mission-delete" aria-label="Sil">×</button>
          </article>
        `).join('') : '<div class="pisi-mission-empty"><strong>Görev yok</strong><p>Aklındaki sonraki adımı ekle.</p></div>'}
      </main>
    </section>
  `);

  const overlay = document.querySelector('#pisi-missions-overlay');
  overlay.querySelector('#pisi-missions-close')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#pisi-mission-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = overlay.querySelector('#pisi-mission-input');
    const text = input.value.trim();
    if (!text) return;
    const current = await loadMissions();
    current.unshift({ id: makeId(), text, done: false, createdAt: new Date().toISOString() });
    await saveMissions(current);
    await renderMissionOverlay();
  });
  overlay.querySelectorAll('.pisi-mission').forEach((row) => {
    row.querySelector('.pisi-mission-toggle')?.addEventListener('click', async () => {
      const current = await loadMissions();
      const mission = current.find(({ id }) => id === row.dataset.missionId);
      if (mission) mission.done = !mission.done;
      await saveMissions(current);
      await renderMissionOverlay();
    });
    row.querySelector('.pisi-mission-delete')?.addEventListener('click', async () => {
      const current = (await loadMissions()).filter(({ id }) => id !== row.dataset.missionId);
      await saveMissions(current);
      await renderMissionOverlay();
    });
  });
}

function injectMissionNavigation() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav || nav.querySelector('#pisi-missions-nav')) return;
  nav.insertAdjacentHTML('beforeend', `
    <button id="pisi-missions-nav" class="nav-button" type="button">
      <span class="nav-icon" aria-hidden="true">✓</span><span>Görevler</span>
    </button>
  `);
  nav.querySelector('#pisi-missions-nav')?.addEventListener('click', renderMissionOverlay);
}

const observer = new MutationObserver(injectMissionNavigation);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('DOMContentLoaded', injectMissionNavigation);
injectMissionNavigation();
