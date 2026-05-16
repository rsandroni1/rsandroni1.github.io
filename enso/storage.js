// localStorage wrappers + schema. All keys prefixed with `enso.`

const K = {
  profile: 'enso.profile',
  sessions: 'enso.sessions',
  plan: 'enso.plan', // legacy — kept for back-compat reads but no longer written
  strava: 'enso.strava',
  anthropic: 'enso.anthropic',
  lastSync: 'enso.lastSync',
  reflections: 'enso.reflections',
  journal: 'enso.journal',
  strategies: 'enso.strategies'
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function remove(key) {
  localStorage.removeItem(key);
}

export const storage = {
  // profile
  getProfile() {
    return read(K.profile, null);
  },
  setProfile(p) {
    write(K.profile, p);
  },
  hasProfile() {
    return this.getProfile() != null;
  },

  // sessions: indexed by ISO date YYYY-MM-DD
  getSessions() {
    return read(K.sessions, {});
  },
  getSession(dateIso) {
    return this.getSessions()[dateIso] || null;
  },
  upsertSession(dateIso, patch) {
    const all = this.getSessions();
    all[dateIso] = { ...(all[dateIso] || {}), ...patch, date: dateIso };
    write(K.sessions, all);
    return all[dateIso];
  },
  deleteSession(dateIso) {
    const all = this.getSessions();
    delete all[dateIso];
    write(K.sessions, all);
  },

  // plan: keyed by ISO date
  getPlan() {
    return read(K.plan, {});
  },
  setPlan(plan) {
    write(K.plan, plan);
  },
  getPlanFor(dateIso) {
    return this.getPlan()[dateIso] || null;
  },

  // strava
  getStrava() {
    return read(K.strava, null);
  },
  setStrava(s) {
    write(K.strava, s);
  },
  clearStrava() {
    remove(K.strava);
  },

  // anthropic
  getAnthropic() {
    return read(K.anthropic, null);
  },
  setAnthropic(a) {
    write(K.anthropic, a);
  },
  clearAnthropic() {
    remove(K.anthropic);
  },

  // sync timestamps
  getLastSync() {
    return read(K.lastSync, { strava: 0, claude: 0 });
  },
  setLastSync(s) {
    write(K.lastSync, s);
  },

  // reflections (legacy — kept readable for users who had Claude on previously)
  getReflections() {
    return read(K.reflections, []);
  },
  addReflection(r) {
    const list = this.getReflections();
    list.unshift(r);
    write(K.reflections, list.slice(0, 60));
  },
  latestReflection() {
    return this.getReflections()[0] || null;
  },

  // journal — optional workout notes
  getJournal() {
    return read(K.journal, []);
  },
  addJournalEntry({ date, sessionType, thoughts }) {
    if (!thoughts?.trim()) return null;
    const list = this.getJournal();
    const entry = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
      date: date || new Date().toISOString().slice(0, 10),
      sessionType: sessionType || null,
      thoughts: thoughts.trim(),
      createdAt: new Date().toISOString()
    };
    list.unshift(entry);
    write(K.journal, list);
    return entry;
  },
  deleteJournalEntry(id) {
    write(K.journal, this.getJournal().filter(e => e.id !== id));
  },

  // strategies — pasted-in plans from Claude or self-written
  getStrategies() {
    return read(K.strategies, []);
  },
  addStrategy({ title, body }) {
    if (!body?.trim()) return null;
    const list = this.getStrategies();
    const entry = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
      title: title?.trim() || 'Untitled strategy',
      body: body.trim(),
      savedAt: new Date().toISOString()
    };
    list.unshift(entry);
    write(K.strategies, list);
    return entry;
  },
  deleteStrategy(id) {
    write(K.strategies, this.getStrategies().filter(e => e.id !== id));
  },

  // export / reset
  exportAll() {
    return {
      profile: this.getProfile(),
      sessions: this.getSessions(),
      plan: this.getPlan(),
      reflections: this.getReflections(),
      journal: this.getJournal(),
      strategies: this.getStrategies(),
      exportedAt: new Date().toISOString()
    };
  },
  resetAll() {
    Object.values(K).forEach(remove);
  }
};

// date helpers
export const dt = {
  today() {
    return this.iso(new Date());
  },
  iso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  parse(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  addDays(iso, n) {
    const d = this.parse(iso);
    d.setDate(d.getDate() + n);
    return this.iso(d);
  },
  startOfWeek(iso) {
    // Monday-start week
    const d = this.parse(iso);
    const dow = d.getDay(); // 0=Sun..6=Sat
    const back = (dow + 6) % 7;
    d.setDate(d.getDate() - back);
    return this.iso(d);
  },
  weeksBetween(isoA, isoB) {
    return Math.round((this.parse(isoB) - this.parse(isoA)) / (1000 * 60 * 60 * 24 * 7));
  },
  prettyDay(iso) {
    return this.parse(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  },
  prettyShort(iso) {
    return this.parse(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  },
  dow(iso) {
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][this.parse(iso).getDay()];
  }
};
