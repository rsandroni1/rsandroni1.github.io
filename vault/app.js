import { hashPin, verifyPin, encryptData, decryptData } from './crypto.js';

// ── State ──────────────────────────────────────────────────────────────────
let sessionPin = null;      // held in memory only, never persisted
let vaultItems = [];        // decrypted items array
let activeCategory = 'All';
let editingId = null;

const CATEGORIES = [
  { id: 'Password',  label: 'Password',  icon: '🔑', cls: 'cat-password'  },
  { id: 'Key Combo', label: 'Key Combo', icon: '⌨️', cls: 'cat-key-combo' },
  { id: 'Note',      label: 'Note',      icon: '📝', cls: 'cat-note'      },
  { id: 'WiFi',      label: 'WiFi',      icon: '📶', cls: 'cat-wifi'      },
  { id: 'Other',     label: 'Other',     icon: '📦', cls: 'cat-other'     },
];

// ── Storage helpers ────────────────────────────────────────────────────────
function getStoredHash()  { return JSON.parse(localStorage.getItem('vault_pin_hash') || 'null'); }
function isFirstRun()     { return !getStoredHash(); }

async function saveItems() {
  const blob = await encryptData(sessionPin, getStoredHash(), vaultItems);
  localStorage.setItem('vault_data', JSON.stringify(blob));
}

async function loadItems() {
  const raw = localStorage.getItem('vault_data');
  if (!raw) return [];
  try {
    return await decryptData(sessionPin, getStoredHash(), JSON.parse(raw));
  } catch { return []; }
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const pinScreen   = document.getElementById('pin-screen');
const mainScreen  = document.getElementById('main-screen');
const pinDots     = document.querySelectorAll('.pin-dot');
const pinTitle    = document.getElementById('pin-title');
const pinSubtitle = document.getElementById('pin-subtitle');
const pinError    = document.getElementById('pin-error');
const itemsList   = document.getElementById('items-list');
const catTabs     = document.getElementById('cat-tabs');
const itemModal   = document.getElementById('item-modal');
const itemOverlay = document.getElementById('item-overlay');
const detailModal = document.getElementById('detail-modal');
const detailOverlay = document.getElementById('detail-overlay');
const settingsModal   = document.getElementById('settings-modal');
const settingsOverlay = document.getElementById('settings-overlay');
const toast = document.getElementById('toast');

// ── PIN entry ──────────────────────────────────────────────────────────────
let pinBuffer = '';
let pinSetupStep = 0;   // 0 = first entry, 1 = confirm
let pinFirstEntry = '';
let pinLocked = false;

function resetPinUI() {
  pinBuffer = '';
  pinDots.forEach(d => d.classList.remove('filled', 'error', 'success'));
}

function updatePinDots(state = 'filled') {
  pinDots.forEach((d, i) => {
    d.classList.remove('filled', 'error', 'success');
    if (i < pinBuffer.length) d.classList.add(state);
  });
}

async function handlePinInput(digit) {
  if (pinLocked || pinBuffer.length >= 4) return;
  pinBuffer += digit;
  updatePinDots();
  pinError.textContent = '';

  if (pinBuffer.length === 4) {
    await processPinComplete();
  }
}

function handlePinDelete() {
  if (pinLocked) return;
  pinBuffer = pinBuffer.slice(0, -1);
  updatePinDots();
  pinError.textContent = '';
}

async function processPinComplete() {
  pinLocked = true;

  if (isFirstRun()) {
    // Setup flow
    if (pinSetupStep === 0) {
      pinFirstEntry = pinBuffer;
      pinSetupStep = 1;
      pinTitle.textContent = 'Confirm PIN';
      pinSubtitle.textContent = 'Enter your PIN again to confirm';
      updatePinDots('success');
      setTimeout(() => { resetPinUI(); pinLocked = false; }, 400);
    } else {
      if (pinBuffer === pinFirstEntry) {
        updatePinDots('success');
        const hash = await hashPin(pinBuffer);
        localStorage.setItem('vault_pin_hash', JSON.stringify(hash));
        sessionPin = pinBuffer;
        vaultItems = [];
        setTimeout(showMain, 500);
      } else {
        showPinError('PINs don\'t match — try again');
        pinSetupStep = 0;
        pinFirstEntry = '';
        pinTitle.textContent = 'Create PIN';
        pinSubtitle.textContent = 'Choose a 4-digit PIN for your vault';
      }
    }
  } else {
    // Unlock flow
    const ok = await verifyPin(pinBuffer, getStoredHash());
    if (ok) {
      updatePinDots('success');
      sessionPin = pinBuffer;
      vaultItems = await loadItems();
      setTimeout(showMain, 400);
    } else {
      showPinError('Wrong PIN — try again');
    }
  }
}

function showPinError(msg) {
  pinError.textContent = msg;
  updatePinDots('error');
  setTimeout(() => { resetPinUI(); pinLocked = false; }, 600);
}

// ── Screen transitions ─────────────────────────────────────────────────────
function showMain() {
  pinScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  renderCategories();
  renderItems();
}

function lockVault() {
  sessionPin = null;
  vaultItems = [];
  pinBuffer = '';
  pinSetupStep = 0;
  pinFirstEntry = '';
  pinLocked = false;
  pinTitle.textContent = 'Enter PIN';
  pinSubtitle.textContent = 'Unlock your vault';
  resetPinUI();
  mainScreen.classList.add('hidden');
  pinScreen.classList.remove('hidden');
  closeAllModals();
}

// ── Render ─────────────────────────────────────────────────────────────────
function catMeta(catId) {
  return CATEGORIES.find(c => c.id === catId) || CATEGORIES[CATEGORIES.length - 1];
}

function renderCategories() {
  const counts = {};
  vaultItems.forEach(it => { counts[it.category] = (counts[it.category] || 0) + 1; });
  const total = vaultItems.length;

  catTabs.innerHTML = '';
  [{ id: 'All', label: `All (${total})` }, ...CATEGORIES.map(c => ({
    id: c.id, label: `${c.icon} ${c.label} ${counts[c.id] ? `(${counts[c.id]})` : ''}`
  }))].forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (activeCategory === cat.id ? ' active' : '');
    btn.textContent = cat.label.trim();
    btn.addEventListener('click', () => { activeCategory = cat.id; renderCategories(); renderItems(); });
    catTabs.appendChild(btn);
  });
}

function renderItems() {
  const filtered = activeCategory === 'All'
    ? vaultItems
    : vaultItems.filter(it => it.category === activeCategory);

  if (filtered.length === 0) {
    itemsList.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔒</div>
      <p>${vaultItems.length === 0 ? 'Your vault is empty.<br>Tap + to add your first item.' : 'No items in this category.'}</p>
    </div>`;
    return;
  }

  itemsList.innerHTML = filtered.map(item => {
    const meta = catMeta(item.category);
    return `<div class="item-card ${meta.cls}" data-id="${item.id}">
      <div class="item-card-header">
        <div class="item-icon">${meta.icon}</div>
        <div class="item-title">${escHtml(item.title)}</div>
        <div class="item-cat-badge">${escHtml(item.category)}</div>
      </div>
      <div class="item-preview">${item.username ? escHtml(item.username) : '••••••••'}</div>
    </div>`;
  }).join('');

  itemsList.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

// ── Add / Edit modal ───────────────────────────────────────────────────────
function openAddModal(id = null) {
  editingId = id;
  const item = id ? vaultItems.find(i => i.id === id) : null;

  document.getElementById('modal-title-text').textContent = item ? 'Edit Item' : 'New Item';
  document.getElementById('item-title-input').value = item?.title || '';
  document.getElementById('item-category').value = item?.category || 'Password';
  document.getElementById('item-username').value = item?.username || '';
  document.getElementById('item-secret').value = item?.secret || '';
  document.getElementById('item-notes').value = item?.notes || '';
  document.getElementById('secret-input').type = 'password';
  document.getElementById('reveal-icon').textContent = '👁';

  const deleteBtn = document.getElementById('delete-btn');
  deleteBtn.style.display = item ? 'block' : 'none';

  updateSecretLabel();
  itemOverlay.classList.add('open');
}

function updateSecretLabel() {
  const cat = document.getElementById('item-category').value;
  const labels = { 'Password': 'Password', 'WiFi': 'Password', 'Key Combo': 'Key Combination', 'Note': 'Content', 'Other': 'Secret / Value' };
  document.getElementById('secret-label').textContent = labels[cat] || 'Secret / Value';
  const usernameGroup = document.getElementById('username-group');
  usernameGroup.style.display = ['Password', 'WiFi', 'Other'].includes(cat) ? 'block' : 'none';
}

async function saveItem() {
  const title = document.getElementById('item-title-input').value.trim();
  const category = document.getElementById('item-category').value;
  const username = document.getElementById('item-username').value.trim();
  const secret = document.getElementById('item-secret').value;
  const notes = document.getElementById('item-notes').value.trim();

  if (!title) { showToast('Title is required'); return; }
  if (!secret) { showToast('Secret/value is required'); return; }

  if (editingId) {
    const idx = vaultItems.findIndex(i => i.id === editingId);
    if (idx !== -1) vaultItems[idx] = { ...vaultItems[idx], title, category, username, secret, notes, updatedAt: Date.now() };
  } else {
    vaultItems.unshift({ id: crypto.randomUUID(), title, category, username, secret, notes, createdAt: Date.now() });
  }

  await saveItems();
  closeAllModals();
  renderCategories();
  renderItems();
  showToast(editingId ? 'Item updated' : 'Item saved');
}

async function deleteItem() {
  if (!editingId) return;
  if (!confirm('Delete this item? This cannot be undone.')) return;
  vaultItems = vaultItems.filter(i => i.id !== editingId);
  await saveItems();
  closeAllModals();
  renderCategories();
  renderItems();
  showToast('Item deleted');
}

// ── Detail modal ───────────────────────────────────────────────────────────
function openDetail(id) {
  const item = vaultItems.find(i => i.id === id);
  if (!item) return;
  const meta = catMeta(item.category);

  document.getElementById('detail-title').textContent = item.title;
  const body = document.getElementById('detail-body');

  let html = `<div class="detail-field">
    <div class="detail-field-label">Category</div>
    <div class="detail-field-value">${meta.icon} ${escHtml(item.category)}</div>
  </div>`;

  if (item.username) html += `<div class="detail-field">
    <div class="detail-field-label">Username / Account</div>
    <div class="copy-row">
      <div class="detail-field-value">${escHtml(item.username)}</div>
      <button class="copy-btn" data-copy="${escAttr(item.username)}">Copy</button>
    </div>
  </div>`;

  html += `<div class="detail-field">
    <div class="detail-field-label">Secret</div>
    <div class="copy-row">
      <div class="detail-field-value secret" id="secret-display" data-revealed="false">••••••••</div>
      <button class="copy-btn" data-copy="${escAttr(item.secret)}" id="copy-secret-btn">Copy</button>
    </div>
    <button class="copy-btn" style="margin-top:8px;padding:0" id="reveal-detail-btn">Show</button>
  </div>`;

  if (item.notes) html += `<div class="detail-field">
    <div class="detail-field-label">Notes</div>
    <div class="detail-field-value" style="white-space:pre-wrap">${escHtml(item.notes)}</div>
  </div>`;

  const ts = item.updatedAt || item.createdAt;
  if (ts) html += `<div style="text-align:center;color:var(--muted);font-size:12px;margin-top:12px">
    ${item.updatedAt ? 'Updated' : 'Added'} ${new Date(ts).toLocaleDateString()}
  </div>`;

  body.innerHTML = html;

  // Reveal toggle
  const revealBtn = body.querySelector('#reveal-detail-btn');
  const secretDisplay = body.querySelector('#secret-display');
  revealBtn?.addEventListener('click', () => {
    const revealed = secretDisplay.dataset.revealed === 'true';
    secretDisplay.textContent = revealed ? '••••••••' : item.secret;
    secretDisplay.dataset.revealed = !revealed;
    revealBtn.textContent = revealed ? 'Show' : 'Hide';
  });

  // Copy buttons
  body.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => showToast('Copied!'));
    });
  });

  // Edit button
  document.getElementById('detail-edit-btn').onclick = () => {
    detailOverlay.classList.remove('open');
    setTimeout(() => openAddModal(id), 50);
  };

  detailOverlay.classList.add('open');
}

// ── Settings modal ─────────────────────────────────────────────────────────
function openSettings() {
  settingsOverlay.classList.add('open');
}

// ── Utilities ──────────────────────────────────────────────────────────────
function closeAllModals() {
  [itemOverlay, detailOverlay, settingsOverlay].forEach(o => o.classList.remove('open'));
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Event wiring ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Keypad
  document.querySelectorAll('.key[data-digit]').forEach(k => {
    k.addEventListener('click', () => handlePinInput(k.dataset.digit));
  });
  document.getElementById('key-delete').addEventListener('click', handlePinDelete);

  // Keyboard support (desktop testing)
  document.addEventListener('keydown', e => {
    if (pinScreen.classList.contains('hidden')) return;
    if (e.key >= '0' && e.key <= '9') handlePinInput(e.key);
    if (e.key === 'Backspace') handlePinDelete();
  });

  // FAB → add item
  document.getElementById('fab-add').addEventListener('click', () => openAddModal());

  // Settings btn
  document.getElementById('settings-btn').addEventListener('click', openSettings);

  // Lock btn
  document.getElementById('lock-btn').addEventListener('click', lockVault);

  // Item form
  document.getElementById('item-category').addEventListener('change', updateSecretLabel);
  document.getElementById('save-item-btn').addEventListener('click', saveItem);
  document.getElementById('cancel-item-btn').addEventListener('click', closeAllModals);
  document.getElementById('delete-btn').addEventListener('click', deleteItem);

  // Reveal toggle in form
  document.getElementById('reveal-btn').addEventListener('click', () => {
    const input = document.getElementById('secret-input');
    const icon = document.getElementById('reveal-icon');
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    icon.textContent = hidden ? '🙈' : '👁';
  });

  // Close modals on overlay click
  [itemOverlay, detailOverlay, settingsOverlay].forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeAllModals();
    });
  });

  // Settings actions
  document.getElementById('change-pin-btn').addEventListener('click', () => {
    closeAllModals();
    localStorage.removeItem('vault_pin_hash');
    localStorage.removeItem('vault_data');
    pinSetupStep = 0; pinFirstEntry = '';
    pinTitle.textContent = 'Create New PIN';
    pinSubtitle.textContent = 'Choose a new 4-digit PIN';
    lockVault();
    showToast('Set your new PIN');
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    const data = JSON.stringify(vaultItems, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'vault-export.json'; a.click();
    URL.revokeObjectURL(url);
    closeAllModals();
    showToast('Exported (unencrypted)');
  });

  document.getElementById('close-settings-btn').addEventListener('click', closeAllModals);

  // Setup PIN screen
  if (isFirstRun()) {
    pinTitle.textContent = 'Create PIN';
    pinSubtitle.textContent = 'Choose a 4-digit PIN for your vault';
  } else {
    pinTitle.textContent = 'Enter PIN';
    pinSubtitle.textContent = 'Unlock your vault';
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
