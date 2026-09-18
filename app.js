/* ============================================================================
   SMART DYNAMIC MENU & MICRO-ORDER SYSTEM
   ----------------------------------------------------------------------------
   app.js — shared "engine" loaded by BOTH index.html (customer menu) and
   admin.html (owner dashboard).

   Architecture (zero build tools — runs straight off any static host):

     ┌──────────────┐    realtime value listeners   ┌──────────────────┐
     │  admin.html  │ ────────────────────────────► │  Firebase RTDB   │
     │  (owner)     │ ◄──────────────────────────── │   /menu (items)  │
     └──────────────┘      bidirectional (CRUD)     │ /orders (log)    │
            ▲                                       └────────▲─────────┘
            │ listens                                        │ listens
     ┌──────────────┐   cart state stays LOCAL (per browser) │
     │  index.html  │ ── reads /menu live, writes order ─────┘
     └──────────────┘

   Firebase is loaded via the v9 "compat" CDN build, which exposes the
   classic firebase.database() (v8-style) API through plain <script> tags —
   no modules, no bundler, no npm.

   DEMO MODE: while FIREBASE_CONFIG below still contains placeholder values,
   the app transparently swaps in an in-memory FakeDatabase that mimics
   ref()/on()/off()/set()/update()/push()/remove() (persisted to
   localStorage + synced across tabs). Paste real credentials and every
   screen instantly switches to true multi-device realtime sync — no other
   code changes needed.

   Sections:
     §0  Config + placeholder detection
     §1  FakeDatabase / FakeRef   (demo-mode Firebase stand-in)
     §2  Seed data (auto-populates an empty database on first load)
     §3  DB bootstrap + master realtime listener
     §4  Connection badge ("Live" pulse / "Offline" / "Demo Mode")
     §5  Cart state machine (add / inc / dec / remove / totals / persist)
     §6  Helpers (₹ format, HTML escaping, toast, confirm dialog)
     §7  CUSTOMER page — render menu, search, category filters, cart drawer,
         validation, WhatsApp deep-link dispatch
     §8  OWNER page — inventory table, stock toggles, add/edit/delete modal
     §9  Bootstrap — detect page, bind events, start the engine
   ========================================================================== */

'use strict';

/* ════════════════════════════════════════════════════════════════════════
   §0  CONFIG — the ONLY two things a shop owner must edit
   ════════════════════════════════════════════════════════════════════════ */

/** Shop's WhatsApp number, full international format, digits only
 *  (e.g. India 91 + 10-digit number → '919876543210'). Orders are delivered
 *  to this number through the universal wa.me deep link. */
const SHOP_PHONE_NUMBER = '919976775973;

/** Shop identity, rendered in headers, page titles and the WhatsApp message. */
const SHOP_NAME = 'Central Cafe';

/** Firebase web-app config. While these values are placeholders the whole app
 *  runs in fully-functional local DEMO MODE (§1). */
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyPLACEHOLDER_REPLACE_WITH_YOUR_KEY',
  authDomain:        'your-project.firebaseapp.com',
  databaseURL:       'https://your-project-default-rtdb.firebaseio.com',
  projectId:         'your-project',
  storageBucket:     'your-project.appspot.com',
  messagingSenderId: '000000000000',
  appId:             '1:000000000000:web:REPLACE_WITH_YOUR_APP_ID',
};

/** True until the config above has been replaced with real credentials. */
const IS_PLACEHOLDER_CONFIG =
  /PLACEHOLDER|REPLACE_WITH|your-project/.test(
    FIREBASE_CONFIG.databaseURL + FIREBASE_CONFIG.apiKey + FIREBASE_CONFIG.projectId
  );

/* ════════════════════════════════════════════════════════════════════════
   §1  FakeDatabase — demo-mode stand-in for firebase.database()
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Minimal re-implementation of a Realtime Database ref: the small slice of
 * the v8 API this app actually uses. Demo and production therefore run the
 * exact same UI code paths.
 */
class FakeRef {
  constructor(dbObj, path) {
    this._db = dbObj;             // owning FakeDatabase
    this._path = path;            // e.g. 'menu' or 'menu/-Nxx/inStock'
    this._listeners = new Map();  // eventType -> Set<callback>
  }

  /** Read nested 'a/b/c' path out of a plain object. */
  static _getAt(obj, path) {
    if (!path) return obj;
    return path.split('/').filter(Boolean).reduce(
      (node, key) => (node == null ? undefined : node[key]), obj);
  }

  /** Write value at 'a/b/c', creating intermediate objects. null deletes. */
  static _setAt(obj, path, value) {
    const keys = path.split('/').filter(Boolean);
    if (!keys.length) return;
    let node = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof node[keys[i]] !== 'object' || node[keys[i]] === null) {
        node[keys[i]] = {};
      }
      node = node[keys[i]];
    }
    const last = keys[keys.length - 1];
    if (value === null) delete node[last]; else node[last] = value;
  }

  /** One-shot read (mirrors ref.once('value') usage). */
  once(eventType = 'value') {
    return Promise.resolve(this._snapshot());
  }

  /** Register a listener; 'value' fires immediately like the real SDK. */
  on(eventType, callback) {
    if (!this._listeners.has(eventType)) this._listeners.set(eventType, new Set());
    this._listeners.get(eventType).add(callback);
    if (eventType === 'value') {
      setTimeout(() => callback(this._snapshot()), 0);
    }
    return callback;
  }

  /** Detach listeners — no args detaches everything at this ref. */
  off(eventType, callback) {
    if (!eventType) { this._listeners.clear(); return; }
    const set = this._listeners.get(eventType);
    if (!set) return;
    if (callback) set.delete(callback); else set.clear();
  }

  /** Create a record under a generated key; returns a thenable ref-like
   *  promise resolving with { key } (mirrors RTDB's ThenableReference). */
  push(value) {
    const key = 'demo-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 7);
    const childPath = this._path + '/' + key;
    if (value === undefined || value === null) {
      return Promise.resolve({ key });
    }
    FakeRef._setAt(this._db._data, childPath, value);
    this._db._emitAll();
    return Promise.resolve({ key });
  }

  set(value) {
    FakeRef._setAt(this._db._data, this._path, value);
    this._db._emitAll();
    return Promise.resolve();
  }

  /** Shallow-merge patch into the object at this path. */
  update(patch) {
    const existing = FakeRef._getAt(this._db._data, this._path);
    const base = (existing && typeof existing === 'object' && !Array.isArray(existing))
      ? existing : {};
    FakeRef._setAt(this._db._data, this._path, Object.assign({}, base, patch));
    this._db._emitAll();
    return Promise.resolve();
  }

  remove() { return this.set(null); }

  /** DataSnapshot look-alike. */
  _snapshot() {
    const val = FakeRef._getAt(this._db._data, this._path);
    const self = this;
    return {
      val: () => (val === undefined ? null : val),
      exists: () => val !== undefined && val !== null,
      forEach(fn) {
        if (val && typeof val === 'object') {
          for (const k of Object.keys(val)) {
            if (fn(new FakeRef(self._db, self._path + '/' + k)._snapshot()) === true) return true;
          }
        }
        return false;
      },
    };
  }
}

/**
 * In-memory database mimicking firebase.database(). Persists to localStorage
 * so demo data survives refreshes, and mirrors across browser tabs via the
 * `storage` event — so you can demo admin + customer side-by-side.
 */
class FakeDatabase {
  static STORE_KEY = 'cc_demo_db';

  constructor() {
    this._data = {};
    this._refs = [];

    try {
      const saved = localStorage.getItem(FakeDatabase.STORE_KEY);
      if (saved) this._data = JSON.parse(saved) || {};
    } catch (_) { /* storage blocked — run memory-only */ }

    // Live cross-tab sync in demo mode.
    window.addEventListener('storage', (e) => {
      if (e.key !== FakeDatabase.STORE_KEY || e.newValue == null) return;
      try {
        this._data = JSON.parse(e.newValue) || {};
        this._emitAll(false); // don't re-persist (would ping-pong)
      } catch (_) { /* ignore malformed writes */ }
    });
  }

  ref(path = '') {
    const r = new FakeRef(this, String(path).replace(/^\/+|\/+$/g, ''));
    this._refs.push(r);
    return r;
  }

  /** Fire every registered 'value' listener. persist=false skips the write. */
  _emitAll(persist = true) {
    if (persist) {
      try { localStorage.setItem(FakeDatabase.STORE_KEY, JSON.stringify(this._data)); }
      catch (_) { /* ignore quota errors */ }
    }
    for (const ref of this._refs) {
      const set = ref._listeners.get('value');
      if (!set || !set.size) continue;
      for (const cb of set) {
        const snap = ref._snapshot();          // compute BEFORE scheduling
        setTimeout(() => cb(snap), 0);          // async, like a network trip
      }
    }
  }
}

/* ════════════════════════════════════════════════════════════════════════
   §2  SEED DATA — populates /menu automatically when the DB is empty
   ════════════════════════════════════════════════════════════════════════ */

const SEED_ITEMS = [
  {
    name: 'Filter Coffee', category: 'Hot Drinks', price: 15, inStock: true,
    image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=640&q=60',
  },
  {
    name: 'Masala Chai', category: 'Hot Drinks', price: 12, inStock: true,
    image: 'https://images.unsplash.com/photo-1594631252845-29fc4cc8cde9?auto=format&fit=crop&w=640&q=60',
  },
  {
    name: 'Masala Dosa', category: 'Tiffin', price: 60, inStock: true,
    image: 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=640&q=60',
  },
  {
    name: 'Idli (2 pc)', category: 'Tiffin', price: 30, inStock: true,
    image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=640&q=60',
  },
  {
    name: 'Samosa', category: 'Snacks', price: 12, inStock: true,
    image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=640&q=60',
  },
  {
    name: 'Veg Puff', category: 'Snacks', price: 15, inStock: false, // demo: starts SOLD OUT
    image: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=640&q=60',
  },
];

/** Stable human-friendly ids for seed rows (new items get push keys). */
const SEED_IDS = ['coffee', 'chai', 'dosa', 'idli', 'samosa', 'puff'];

/* ════════════════════════════════════════════════════════════════════════
   §3  DB BOOTSTRAP + MASTER REALTIME LISTENER
   ════════════════════════════════════════════════════════════════════════ */

let db = null;              // firebase.database() OR FakeDatabase
let menuCache = {};         // last known menu: { id: {name, category, ...} }
let connectionState = false;// true ⇒ badge shows Live / Demo Mode
let firstSnapshotDone = false;

/** Boot the DB (real Firebase or demo), attach listeners, seed if empty. */
function initDatabase() {
  if (IS_PLACEHOLDER_CONFIG) {
    db = new FakeDatabase();
    connectionState = true;                 // demo mode is always "live"
    attachMenuListener();
    seedIfEmpty();
    paintConnectionBadges();
    return Promise.resolve();
  }

  if (typeof firebase === 'undefined') {
    console.error('[SmartMenu] Firebase SDK missing — check the <script> tags.');
    alert('Firebase SDK failed to load. Check your internet connection and reload.');
    paintConnectionBadges();
    return Promise.resolve();
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
  } catch (err) {
    console.error('[SmartMenu] Firebase init failed:', err);
    alert('Firebase failed to initialise: ' + err.message);
    paintConnectionBadges();
    return Promise.resolve();
  }

  attachMenuListener();

  // Seed an empty database exactly once.
  db.ref('menu').once('value').then((snap) => {
    if (!snap.exists()) seedIfEmpty();
  }).catch((err) => console.error('[SmartMenu] seed check failed:', err));

  // `.info/connected` flips true while the websocket is attached.
  db.ref('.info/connected').on('value', (snap) => {
    connectionState = !!snap.val();
    paintConnectionBadges();
  });

  return Promise.resolve();
}

/**
 * The single master listener that drives BOTH pages: every change under
 * /menu re-renders whichever page is currently open.
 */
function attachMenuListener() {
  db.ref('menu').on('value', (snap) => {
    const val = snap.val() || {};

    // Normalise into a plain object with guaranteed field types.
    const menu = {};
    Object.keys(val).forEach((id) => {
      const it = val[id];
      if (it && typeof it === 'object' && it.name) {
        menu[id] = {
          name: String(it.name),
          category: String(it.category || 'Others'),
          price: Number(it.price) || 0,
          inStock: it.inStock !== false,   // default: In Stock
          image: String(it.image || ''),
        };
      }
    });
    menuCache = menu;

    // Customer page: drop cart lines whose item vanished from the menu,
    // and (first snapshot only) restore the persisted cart.
    if (document.getElementById('menu-grid')) {
      if (!firstSnapshotDone) {
        firstSnapshotDone = true;
        loadCart();
        // First paint complete — reveal the page (index.html hides the body
        // until this attribute exists, preventing a flash of empty content).
        document.documentElement.setAttribute('data-ready', '');
      }
      let stale = false;
      for (const id of Object.keys(cart)) {
        if (!menuCache[id]) { delete cart[id]; stale = true; }
      }
      if (stale) persistCart();
      syncCartUI();
    }

    // Hand the fresh menu to whichever renderer exists on this page.
    if (typeof renderMenu === 'function') renderMenu(menu);
    if (typeof renderAdminTable === 'function') renderAdminTable(menu);
  }, (err) => {
    console.error('[SmartMenu] menu listener error:', err);
    toast('⚠️ Database read failed — check Firebase rules / config.');
  });
}

/** Write SEED_ITEMS to /menu when it is currently empty. */
function seedIfEmpty() {
  db.ref('menu').once('value').then((snap) => {
    const val = snap.val();
    if (val && typeof val === 'object' && Object.keys(val).length) return;
    const seedObj = {};
    SEED_IDS.forEach((id, i) => { seedObj[id] = { ...SEED_ITEMS[i] }; });
    return db.ref('menu').set(seedObj).catch(
      (err) => console.error('[SmartMenu] seeding failed:', err));
  }).catch((err) => console.error('[SmartMenu] seed read failed:', err));
}

/* ════════════════════════════════════════════════════════════════════════
   §4  CONNECTION BADGE — pulsing "Live" / "Demo Mode" / "Offline"
   ════════════════════════════════════════════════════════════════════════ */

function paintConnectionBadges() {
  document.querySelectorAll('[data-conn-badge]').forEach((badge) => {
    const dot = badge.querySelector('.dot, .conn-dot'); // both pages supported
    const label = badge.querySelector('.label');
    if (!dot || !label) return;

    if (connectionState) {
      badge.classList.remove('conn-off');
      badge.classList.add('conn-on');
      label.textContent = IS_PLACEHOLDER_CONFIG ? 'Demo Mode' : 'Live';
      dot.title = IS_PLACEHOLDER_CONFIG
        ? 'Demo database (placeholder Firebase config — paste real credentials in app.js)'
        : 'Connected to Firebase Realtime Database';
    } else {
      badge.classList.remove('conn-on');
      badge.classList.add('conn-off');
      label.textContent = 'Offline';
      dot.title = 'Not connected — showing last known state';
    }
  });
}

/* ════════════════════════════════════════════════════════════════════════
   §5  CART STATE MACHINE — customer-side; persisted to localStorage
   ════════════════════════════════════════════════════════════════════════ */

const CART_MAX_QTY = 20;   // sanity cap per item
let cart = {};             // { itemId: qty }
let cartLoaded = false;

/** Restore persisted cart, keeping only items that still exist and are in
 *  stock. Called once, on the first menu snapshot (§3). */
function loadCart() {
  cartLoaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem('cc_cart') || '{}');
    for (const [id, qty] of Object.entries(saved)) {
      if (menuCache[id] && menuCache[id].inStock &&
          Number.isFinite(qty) && qty > 0) {
        cart[id] = Math.min(Math.floor(qty), CART_MAX_QTY);
      }
    }
  } catch (_) { cart = {}; }
}

function persistCart() {
  try { localStorage.setItem('cc_cart', JSON.stringify(cart)); } catch (_) {}
}

/** Add one unit of an item (menu card "Add +" button). */
function addToCart(id) {
  const item = menuCache[id];
  if (!item || !item.inStock) { toast('Sorry — that item is sold out.'); return; }
  cart[id] = Math.min((cart[id] || 0) + 1, CART_MAX_QTY);
  persistCart();
  syncCartUI();
  bumpCart();
}

/** Increment quantity (card stepper / cart drawer). */
function incQty(id) {
  if (!cart[id]) return;
  if (cart[id] >= CART_MAX_QTY) { toast('Maximum ' + CART_MAX_QTY + ' per item.'); return; }
  const item = menuCache[id];
  if (item && !item.inStock) {          // sold out while sitting in the cart
    delete cart[id];
    persistCart();
    syncCartUI();
    toast('That item just sold out — removed from your cart.');
    return;
  }
  cart[id] += 1;
  persistCart();
  syncCartUI();
}

/** Decrement quantity; removes the line at zero. */
function decQty(id) {
  if (!cart[id]) return;
  cart[id] -= 1;
  if (cart[id] <= 0) delete cart[id];
  persistCart();
  syncCartUI();
}

/** Remove a line item entirely. */
function removeLine(id) {
  delete cart[id];
  persistCart();
  syncCartUI();
}

/** Empty the cart (after a successful order dispatch). */
function clearCart() {
  cart = {};
  persistCart();
  syncCartUI();
}

/** Cart totals: { count, total } across all lines. */
function cartTotals() {
  let count = 0, total = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const it = menuCache[id];
    if (!it) continue;
    count += qty;
    total += qty * (Number(it.price) || 0);
  }
  return { count, total };
}

/** One-shot pop animation on the floating cart bar. */
function bumpCart() {
  const fab = document.getElementById('cart-fab');
  if (!fab) return;
  fab.classList.remove('bump');
  void fab.offsetWidth;                 // force reflow to restart animation
  fab.classList.add('bump');
}

/* ════════════════════════════════════════════════════════════════════════
   §6  HELPERS
   ════════════════════════════════════════════════════════════════════════ */

/** 1234 → "₹1,234" (en-IN digit grouping, whole-rupee menu prices). */
const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

/** Escape untrusted text before it touches innerHTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Deterministic pastel hue from the item name (used for avatar chips). */
function nameHue(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Inline style for an imageless avatar chip. */
function avatarStyle(name) {
  return 'background:hsl(' + nameHue(name) + ' 65% 88%);color:hsl(' + nameHue(name) + ' 45% 32%)';
}

/** First letters of up to two words: "Filter Coffee" → "FC". */
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map((w) => (w[0] ? w[0].toUpperCase() : '')).join('') || '?';
}

/** Lightweight toast (auto-dismisses). Works on both pages. */
function toast(msg, ms = 2200) {
  let el = document.getElementById('__mini_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '__mini_toast';
    el.style.cssText =
      'position:fixed;left:50%;bottom:96px;transform:translateX(-50%) translateY(16px);' +
      'background:#1e293b;color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;' +
      'font-family:Inter,sans-serif;z-index:9999;opacity:0;transition:all .25s;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:88vw;text-align:center;pointer-events:none';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(16px)';
  }, ms);
}

/** Small in-page confirmation for destructive actions (no window.confirm). */
function confirmDialog(message, onYes) {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);' +
    'display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px';
  wrap.innerHTML =
    '<div style="background:#fff;border-radius:16px;padding:20px;max-width:340px;width:100%;' +
    'box-shadow:0 24px 48px rgba(0,0,0,.25);font-family:Inter,sans-serif">' +
      '<p style="margin:0 0 16px;font-size:14px;color:#0f172a;line-height:1.5">' +
        esc(message) + '</p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button data-x="no" style="padding:8px 14px;border-radius:10px;' +
          'border:1px solid #e2e8f0;background:#fff;font-size:13px;cursor:pointer">Cancel</button>' +
        '<button data-x="yes" style="padding:8px 14px;border-radius:10px;border:0;' +
          'background:#dc2626;color:#fff;font-size:13px;cursor:pointer">Delete</button>' +
      '</div>' +
    '</div>';
  wrap.querySelector('[data-x="no"]').onclick = () => wrap.remove();
  wrap.querySelector('[data-x="yes"]').onclick = () => { wrap.remove(); onYes(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
  document.body.appendChild(wrap);
}

/* ════════════════════════════════════════════════════════════════════════
   §7  CUSTOMER PAGE (index.html)
   ════════════════════════════════════════════════════════════════════════ */

let activeCategory = 'All';
let searchTerm = '';

/** Master renderer for the menu grid. Re-reads the global filter state. */
function renderMenu(menu) {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;                                   // we're on admin.html

  const emptyState = document.getElementById('empty-state');
  const all = Object.entries(menu);

  // ---- filtering: category pill + free-text search -----------------------
  const term = searchTerm.trim().toLowerCase();
  const visible = all.filter(([, it]) => {
    const catOk = activeCategory === 'All' || it.category === activeCategory;
    const textOk = !term ||
      it.name.toLowerCase().includes(term) ||
      it.category.toLowerCase().includes(term);
    return catOk && textOk;
  });

  // ---- category pills (rebuilt so live counts stay accurate) -------------
  // 'All' first, remaining categories alphabetically (Hot Drinks, Snacks, Tiffin…).
  const uniqueCats = [...new Set(all.map(([, it]) => it.category))].sort();
  const cats = ['All', ...uniqueCats];
  const pills = document.getElementById('category-pills');
  if (pills) {
    pills.innerHTML = cats.map((c) => {
      const n = c === 'All'
        ? all.length
        : all.filter(([, it]) => it.category === c).length;
      const on = activeCategory === c;
      return '<button class="cat-pill' + (on ? ' cat-active' : '') +
        '" data-cat="' + esc(c) + '">' + esc(c) +
        ' <span class="count">' + n + '</span></button>';
    }).join('');
  }

  // ---- empty search / filter result ---------------------------------------
  if (!visible.length) {
    grid.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  // ---- menu cards ----------------------------------------------------------
  grid.innerHTML = visible.map(([id, it]) => {
    const qty = cart[id] || 0;
    const media = it.image
      ? '<img src="' + esc(it.image) + '" alt="' + esc(it.name) + '" loading="lazy"' +
        ' onerror="this.outerHTML=\'<div class=&quot;img-fallback&quot; style=&quot;' +
        esc(avatarStyle(it.name)) + '&quot;>' + esc(initials(it.name)) + '</div>\'">'
      : '<div class="img-fallback" style="' + esc(avatarStyle(it.name)) + '">' +
        esc(initials(it.name)) + '</div>';

    const orderControl = it.inStock
      ? (qty
        ? '<div class="stepper">' +
          '<button class="step-btn" data-dec="' + esc(id) + '" aria-label="Decrease">−</button>' +
          '<span class="step-n">' + qty + '</span>' +
          '<button class="step-btn" data-inc="' + esc(id) + '" aria-label="Increase">+</button>' +
          '</div>'
        : '<button class="add-btn" data-add="' + esc(id) + '">Add +</button>')
      : '<button class="add-btn" disabled>Add +</button>';

    return (
      '<article class="menu-card' + (it.inStock ? '' : ' soldout') + '" data-id="' + esc(id) + '">' +
        '<div class="card-thumb">' + media +
          (it.inStock ? '' : '<span class="badge-soldout">Sold Out</span>') +
          (qty ? '<span class="badge-qty">' + qty + ' in cart</span>' : '') +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-top"><span class="cat-chip">' + esc(it.category) + '</span>' +
          '<span class="veg-dot" title="Veg"></span></div>' +
          '<h3>' + esc(it.name) + '</h3>' +
          '<div class="card-bottom"><span class="price">' + fmt(it.price) + '</span>' +
          orderControl + '</div>' +
        '</div>' +
      '</article>');
  }).join('');
}

/** Wire every customer-page event (delegated — survives re-renders). */
function bindCustomerUI() {
  // Real-time search (debounced).
  const search = document.getElementById('search-input');
  if (search) {
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { searchTerm = search.value; renderMenu(menuCache); }, 120);
    });
  }

  // Category pills.
  const pills = document.getElementById('category-pills');
  if (pills) {
    pills.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      activeCategory = btn.dataset.cat;
      renderMenu(menuCache);
    });
  }

  // Menu grid: Add / + / − buttons.
  const grid = document.getElementById('menu-grid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      const inc = e.target.closest('[data-inc]');
      const dec = e.target.closest('[data-dec]');
      if (add) addToCart(add.dataset.add);
      else if (inc) incQty(inc.dataset.inc);
      else if (dec) decQty(dec.dataset.dec);
    });
  }

  // Floating cart bar opens the checkout drawer.
  const fab = document.getElementById('cart-fab');
  if (fab) fab.addEventListener('click', openCart);

  // Drawer close affordances (×, scrim).
  document.querySelectorAll('[data-close-cart]').forEach(
    (el) => el.addEventListener('click', closeCart));

  // Drawer line controls.
  const lines = document.getElementById('cart-lines');
  if (lines) {
    lines.addEventListener('click', (e) => {
      const inc = e.target.closest('[data-inc]');
      const dec = e.target.closest('[data-dec]');
      const rem = e.target.closest('[data-remove]');
      if (inc) incQty(inc.dataset.inc);
      else if (dec) decQty(dec.dataset.dec);
      else if (rem) removeLine(rem.dataset.remove);
    });
  }

  // Clear field-level validation errors as the user types.
  ['table-no', 'cust-name', 'note'].forEach((fid) => {
    const f = document.getElementById(fid);
    if (!f) return;
    f.addEventListener('input', () => {
      f.classList.remove('invalid');
      const err = document.getElementById(fid + '-err');
      if (err) err.classList.add('hidden');
    });
  });

  // Checkout submit.
  const form = document.getElementById('checkout-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sendOrderViaWhatsApp();
    });
  }
}

/* ---- Cart drawer / checkout --------------------------------------------- */

function openCart() {
  const drawer = document.getElementById('cart-drawer');
  const scrim = document.getElementById('drawer-scrim');
  if (!drawer) return;
  renderCartDrawer();
  drawer.classList.add('open');
  if (scrim) scrim.classList.add('show');
  document.body.classList.add('no-scroll');
}

function closeCart() {
  const drawer = document.getElementById('cart-drawer');
  const scrim = document.getElementById('drawer-scrim');
  if (!drawer) return;
  drawer.classList.remove('open');
  if (scrim) scrim.classList.remove('show');
  document.body.classList.remove('no-scroll');
}

/** Refresh every piece of cart UI (bar + drawer) from current cart state. */
function syncCartUI() {
  renderCartBar();
  renderCartDrawer();
}

/** Sticky bottom summary bar: item count + running total. */
function renderCartBar() {
  const bar = document.getElementById('cart-fab');
  if (!bar) return;
  const { count, total } = cartTotals();
  const cEl = bar.querySelector('.fab-count');
  const tEl = bar.querySelector('.fab-total');
  const bEl = bar.querySelector('.fab-badge');
  if (cEl) cEl.textContent = count ? count + ' item' + (count > 1 ? 's' : '') : 'Cart empty';
  if (tEl) tEl.textContent = fmt(total);
  if (bEl) { bEl.textContent = count; bEl.classList.toggle('hidden', count === 0); }
  bar.classList.toggle('has-items', count > 0);
  bar.disabled = count === 0;
}

/** Checkout drawer: itemised lines with steppers + grand total. */
function renderCartDrawer() {
  const wrap = document.getElementById('cart-lines');
  if (!wrap) return;

  const ids = Object.keys(cart);
  const foot = document.getElementById('cart-footer');

  if (!ids.length) {
    wrap.innerHTML =
      '<div class="empty-cart"><div class="empty-cart-icon">🛒</div>' +
      '<p>Your cart is empty.<br>Add something tasty from the menu!</p></div>';
    if (foot) foot.classList.add('hidden');
    return;
  }
  if (foot) foot.classList.remove('hidden');

  let subtotal = 0;
  wrap.innerHTML = ids.map((id) => {
    const it = menuCache[id];
    if (!it) return '';                       // item deleted mid-session
    const line = it.price * cart[id];
    subtotal += line;
    return (
      '<div class="line">' +
        '<div class="line-thumb">' +
          (it.image
            ? '<img src="' + esc(it.image) + '" alt=""' +
              ' onerror="this.outerHTML=\'<div class=&quot;img-fallback&quot; style=&quot;' +
              esc(avatarStyle(it.name)) + '&quot;>' + esc(initials(it.name)) + '</div>\'">'
            : '<div class="img-fallback" style="' + esc(avatarStyle(it.name)) + '">' +
              esc(initials(it.name)) + '</div>') +
        '</div>' +
        '<div class="line-info">' +
          '<div class="line-name">' + esc(it.name) + '</div>' +
          '<div class="line-sub">' + fmt(it.price) + ' × ' + cart[id] + '</div>' +
        '</div>' +
        '<div class="line-right">' +
          '<div class="line-amt">' + fmt(line) + '</div>' +
          '<div class="stepper small">' +
            '<button class="step-btn" data-dec="' + esc(id) + '" aria-label="Decrease">−</button>' +
            '<span class="step-n">' + cart[id] + '</span>' +
            '<button class="step-btn" data-inc="' + esc(id) + '" aria-label="Increase">+</button>' +
          '</div>' +
          '<button class="line-remove" data-remove="' + esc(id) + '" title="Remove item">🗑</button>' +
        '</div>' +
      '</div>');
  }).join('');

  const totalEl = document.getElementById('cart-total');
  if (totalEl) totalEl.textContent = fmt(subtotal);
}

/* ---- WhatsApp dispatch ---------------------------------------------------- */

/**
 * Validate the checkout form, compose the order text and hand it to WhatsApp
 * via the universal wa.me deep link. Returns false when validation fails.
 */
function sendOrderViaWhatsApp() {
  const { count, total } = cartTotals();
  if (!count) { toast('Your cart is empty.'); return false; }

  // ---- required: table number ----------------------------------------------
  const tableInput = document.getElementById('table-no');
  const tableErr = document.getElementById('table-no-err');
  const table = ((tableInput && tableInput.value) || '').trim().toUpperCase();

  if (!table) {
    if (tableInput) tableInput.classList.add('invalid');
    if (tableErr) { tableErr.textContent = 'Table number is required.'; tableErr.classList.remove('hidden'); }
    if (tableInput) tableInput.focus();
    toast('Please enter your table number.');
    return false;
  }
  if (!/^[A-Z0-9\- ]{1,6}$/.test(table)) {
    if (tableInput) tableInput.classList.add('invalid');
    if (tableErr) { tableErr.textContent = 'Use 1–6 letters/numbers (e.g. 12, A1).'; tableErr.classList.remove('hidden'); }
    return false;
  }

  // ---- optional fields --------------------------------------------------------
  const name = ((document.getElementById('cust-name') || {}).value || '').trim();
  const note = ((document.getElementById('note') || {}).value || '').trim();

  // ---- compose the WhatsApp message -------------------------------------------
  const lines = [
    '*NEW ORDER — ' + SHOP_NAME + '*',
    'Table: ' + table,
    '',
    'Items:',
  ];
  Object.entries(cart).forEach(([id, qty]) => {
    const it = menuCache[id];
    if (it) lines.push('• ' + it.name + ' × ' + qty + ' — ' + fmt(it.price * qty));
  });
  lines.push('', '*' + 'Grand Total: ' + fmt(total) + '*');
  if (name) lines.push('Name: ' + name);
  if (note) lines.push('Note: ' + note);
  lines.push('', '— Sent from ' + SHOP_NAME + ' Smart Menu');

  // ---- log the order to /orders (best-effort; never blocks the handoff) -------
  try {
    db.ref('orders').push({
      table: table,
      customerName: name || '(not given)',
      note: note,
      items: Object.entries(cart).map(([id, qty]) => ({
        id: id,
        name: (menuCache[id] && menuCache[id].name) || id,
        qty: qty,
        price: (menuCache[id] && menuCache[id].price) || 0,
      })),
      total: total,
      placedAt: new Date().toISOString(),
    });
  } catch (err) { console.warn('[SmartMenu] order log failed:', err); }

  // ---- open WhatsApp ------------------------------------------------------------
  const url = 'https://wa.me/' + SHOP_PHONE_NUMBER +
    '?text=' + encodeURIComponent(lines.join('\n'));
  window.open(url, '_blank', 'noopener');

  toast('✅ Opening WhatsApp…');
  closeCart();
  clearCart();
  ['table-no', 'cust-name', 'note'].forEach((fid) => {
    const f = document.getElementById(fid);
    if (f) f.value = '';
  });
  return true;
}

/* ════════════════════════════════════════════════════════════════════════
   §8  OWNER PAGE (admin.html)
   ════════════════════════════════════════════════════════════════════════ */

/** Render the inventory table + stat cards. Driven by the master listener. */
function renderAdminTable(menu) {
  const tbody = document.getElementById('admin-tbody');
  if (!tbody) return;                                   // we're on index.html

  const ids = Object.keys(menu);
  const emptyEl = document.getElementById('admin-empty');

  if (!ids.length) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
  } else {
    if (emptyEl) emptyEl.classList.add('hidden');
    tbody.innerHTML = ids.map((id) => {
      const it = menu[id];
      const inStock = !!it.inStock;
      const thumb = it.image
        ? '<img class="row-thumb" src="' + esc(it.image) + '" alt="" loading="lazy"' +
          ' onerror="this.outerHTML=\'<div class=&quot;row-thumb img-fallback&quot; style=&quot;' +
          esc(avatarStyle(it.name)) + '&quot;>' + esc(initials(it.name)) + '</div>\'">'
        : '<div class="row-thumb img-fallback" style="' + esc(avatarStyle(it.name)) + '">' +
          esc(initials(it.name)) + '</div>';

      return (
        '<tr data-id="' + esc(id) + '" class="' + (inStock ? '' : 'row-soldout') + '">' +
          '<td>' + thumb + '</td>' +
          '<td><div class="cell-name">' + esc(it.name) + '</div>' +
              '<div class="cell-id">' + esc(id) + '</div></td>' +
          '<td><span class="cat-chip">' + esc(it.category) + '</span></td>' +
          '<td class="cell-price">' + fmt(it.price) + '</td>' +
          '<td><label class="switch" title="' + (inStock ? 'In Stock' : 'Sold Out') + '">' +
            '<input type="checkbox" data-toggle="' + esc(id) + '"' + (inStock ? ' checked' : '') + '>' +
            '<span class="slider"></span></label></td>' +
          '<td><div class="row-actions">' +
            '<button class="icon-btn edit" data-edit="' + esc(id) + '" title="Edit">✏️</button>' +
            '<button class="icon-btn del" data-del="' + esc(id) + '" title="Delete">🗑️</button>' +
          '</div></td>' +
        '</tr>');
    }).join('');
  }

  // ---- stat cards ----------------------------------------------------------
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.textContent = v; };
  set('stat-total', ids.length);
  const avail = ids.filter((id) => menu[id].inStock).length;
  set('stat-avail', avail);
  set('stat-out', ids.length - avail);
  set('stat-cats', new Set(ids.map((id) => menu[id].category)).size);
}

/** Wire owner-page events (delegated — survives re-renders). */
function bindAdminUI() {
  const tbody = document.getElementById('admin-tbody');
  if (!tbody) return;

  // Stock toggle → writes /menu/<id>/inStock; realtime sync pushes it to
  // every open customer screen instantly.
  tbody.addEventListener('change', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const id = t.dataset.toggle;
    db.ref('menu/' + id + '/inStock').set(!!t.checked)
      .then(() => toast(t.checked ? '✅ Marked IN STOCK' : '🚫 Marked SOLD OUT'))
      .catch((err) => {
        console.error(err);
        toast('Update failed — reverting.');
        t.checked = !t.checked;             // optimistic-UI rollback
      });
  });

  // Edit / Delete actions.
  tbody.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) openItemModal(edit.dataset.edit);
    if (del) {
      const it = menuCache[del.dataset.del];
      confirmDialog('Delete “' + (it ? it.name : 'this item') +
        '” from the menu? This cannot be undone.', () => {
        db.ref('menu/' + del.dataset.del).remove()
          .then(() => toast('Item deleted'))
          .catch((err) => { console.error(err); toast('Delete failed.'); });
      });
    }
  });

  // Modal open / close.
  document.querySelectorAll('[data-open-add]').forEach(
    (b) => b.addEventListener('click', () => openItemModal(null)));
  document.querySelectorAll('[data-close-modal]').forEach(
    (b) => b.addEventListener('click', closeItemModal));
  const scrim = document.getElementById('modal-scrim');
  if (scrim) scrim.addEventListener('click', closeItemModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeItemModal();
  });

  // Save handler.
  const form = document.getElementById('item-form');
  if (form) form.addEventListener('submit', saveItemForm);
}

/* ---- Add / Edit modal -------------------------------------------------------- */

let editingId = null;   // null ⇒ "Add new", otherwise the id being edited

function openItemModal(id) {
  editingId = id || null;
  const modal = document.getElementById('item-modal');
  if (!modal) return;

  const title = document.getElementById('modal-title');
  const name  = document.getElementById('f-name');
  const cat   = document.getElementById('f-cat');
  const price = document.getElementById('f-price');
  const img   = document.getElementById('f-image');
  const stock = document.getElementById('f-stock');
  const it = editingId ? menuCache[editingId] : null;

  if (title) title.textContent = editingId ? '✏️ Edit Item' : '➕ Add New Item';
  if (name)  name.value  = it ? it.name : '';
  if (cat)   cat.value   = it ? it.category : 'Hot Drinks';
  if (price) price.value = it ? it.price : '';
  if (img)   img.value   = it ? it.image : '';
  if (stock) stock.checked = it ? !!it.inStock : true;

  ['f-name', 'f-price'].forEach((fid) => {
    const f = document.getElementById(fid);
    if (f) f.classList.remove('invalid');
    const err = document.getElementById(fid + '-err');
    if (err) err.classList.add('hidden');
  });

  modal.classList.add('open');
  setTimeout(() => { if (name) name.focus(); }, 60);
}

function closeItemModal() {
  const modal = document.getElementById('item-modal');
  if (modal) modal.classList.remove('open');
  editingId = null;
}

/** Validate + persist the modal form (create or update in Firebase). */
function saveItemForm(e) {
  e.preventDefault();
  const name  = document.getElementById('f-name');
  const cat   = document.getElementById('f-cat');
  const price = document.getElementById('f-price');
  const img   = document.getElementById('f-image');
  const stock = document.getElementById('f-stock');
  if (!name || !price) return;

  const vName  = name.value.trim();
  const vPrice = parseFloat(price.value);

  let ok = true;
  if (!vName) { markInvalid(name, 'Item name is required.'); ok = false; }
  if (!price.value.trim() || Number.isNaN(vPrice) || vPrice <= 0) {
    markInvalid(price, 'Enter a price greater than 0.'); ok = false;
  }
  if (!ok) return;

  const record = {
    name: vName,
    category: (cat && cat.value) || 'Others',
    price: Math.round(vPrice * 100) / 100,
    image: (img && img.value.trim()) || '',
    inStock: stock ? stock.checked : true,
  };

  const wasEditing = !!editingId;
  const done = () => { closeItemModal(); toast(wasEditing ? '✅ Item updated' : '✅ Item added'); };
  const fail = (err) => { console.error(err); toast('Save failed — check connection.'); };

  if (wasEditing) {
    db.ref('menu/' + editingId).update(record).then(done).catch(fail);
  } else {
    db.ref('menu').push(record).then(done).catch(fail);
  }
}

function markInvalid(input, msg) {
  input.classList.add('invalid');
  const err = document.getElementById(input.id + '-err');
  if (err) { err.textContent = msg; err.classList.remove('hidden'); }
  input.focus();
}

/* ════════════════════════════════════════════════════════════════════════
   §9  BOOTSTRAP — detect which page we're on and start the engine
   ════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  const isCustomer = !!document.getElementById('menu-grid');
  const isAdmin    = !!document.getElementById('admin-tbody');

  if (isCustomer) bindCustomerUI();
  if (isAdmin) bindAdminUI();

  // Cart is restored on the first /menu snapshot (see §3) so we can validate
  // it against real stock levels before showing it.
  initDatabase().then(() => {
    if (isCustomer && firstSnapshotDone) syncCartUI();
  });

  // Demo-mode banner (admin.html) — shown while Firebase config is placeholder.
  const demoBanner = document.getElementById('demo-banner');
  if (demoBanner && IS_PLACEHOLDER_CONFIG) demoBanner.classList.remove('hidden');

  // Safety net: never leave the customer page invisible (e.g. listener error).
  setTimeout(() => document.documentElement.setAttribute('data-ready', ''), 1500);

  // Gentle warning before leaving with a non-empty cart (customer page only).
  if (isCustomer) {
    window.addEventListener('beforeunload', (e) => {
      if (Object.keys(cart).length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // Debug handle: inspect live state from DevTools via `SmartMenu`.
  window.SmartMenu = {
    get menu() { return menuCache; },
    get cart() { return cart; },
    demoMode: IS_PLACEHOLDER_CONFIG,
  };
});
