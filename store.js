async function init() {
  const res = await fetch('/apps.json');
  const data = await res.json();

  document.title = data.storeTitle || 'My Apps';
  document.getElementById('store-title').textContent = data.storeTitle || 'My Apps';
  document.getElementById('app-count').textContent =
    `${data.apps.length} app${data.apps.length !== 1 ? 's' : ''}`;

  renderApps(data.apps);
  renderWhatsNew(data.apps);
  checkInstalled();
}

function renderApps(apps) {
  const container = document.getElementById('apps-container');
  container.innerHTML = apps.map(app => `
    <a class="app-card" href="${app.url}">
      <div class="app-card-top">
        <div class="app-icon">
          <img src="${app.icon}" alt="${app.name}" onerror="this.parentElement.innerHTML='<div class=\\'app-icon-fallback\\'>${iconFor(app.category)}</div>'; this.parentElement.style.background='none'">
        </div>
        <div class="app-meta">
          <div class="app-name">${esc(app.name)}</div>
          <div class="app-category">${esc(app.category)}</div>
          <div class="app-version">v${esc(app.version)} · ${formatDate(app.releaseDate)}</div>
        </div>
        <button class="open-btn" onclick="event.preventDefault(); window.location.href='${app.url}'">Open</button>
      </div>
      <div class="app-description">${esc(app.description)}</div>
    </a>
  `).join('');
}

function renderWhatsNew(apps) {
  const container = document.getElementById('whats-new-container');
  const allEntries = [];

  apps.forEach(app => {
    (app.changelog || []).forEach(entry => {
      allEntries.push({ app, entry });
    });
  });

  // Sort newest first
  allEntries.sort((a, b) => new Date(b.entry.date) - new Date(a.entry.date));
  const recent = allEntries.slice(0, 5);

  if (recent.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);font-size:14px;padding:8px 0">No updates yet.</p>';
    return;
  }

  container.innerHTML = recent.map((item, i) => `
    <div class="whats-new ${i === 0 ? 'open' : ''}" data-idx="${i}">
      <div class="whats-new-header">
        <div class="wn-app-icon">
          <img src="${item.app.icon}" alt="${item.app.name}" onerror="this.style.display='none'">
        </div>
        <div class="wn-meta">
          <div class="wn-app-name">${esc(item.app.name)}</div>
          <div class="wn-version">v${esc(item.entry.version)} · ${formatDate(item.entry.date)}</div>
        </div>
        <span class="wn-chevron">›</span>
      </div>
      <div class="wn-notes">
        <ul>${item.entry.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.whats-new-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.whats-new').classList.toggle('open');
    });
  });
}

function checkInstalled() {
  // Hide install banner if already running as standalone (installed PWA)
  const isStandalone = window.navigator.standalone ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone) {
    document.getElementById('install-banner').classList.add('hidden');
  }
}

function iconFor(category) {
  const map = { 'Utilities': '🔧', 'Games': '🎮', 'Finance': '💰', 'Health': '❤️', 'Productivity': '✅' };
  return map[category] || '📱';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/store-sw.js').catch(() => {});
}

init().catch(console.error);
