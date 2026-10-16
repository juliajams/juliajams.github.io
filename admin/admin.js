import {
  renderHome, renderProject, renderSite,
  EXPERTISE_ICONS, SOCIAL_ICONS, flat
} from '../src/render.js';

/* ==========================================================================
   Small helpers
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  const target = ks.reduce((a, k) => a[k], o);
  target[last] = v;
}

function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 7000 : 3500);
}

const SITE_ROOT = new URL('../', location.href).href; // the site's root URL (admin lives in /admin/)
const PLACEHOLDER = {
  wide: 'images/placeholders/wide.svg',
  cover: 'images/placeholders/cover.svg',
  gallery: 'images/placeholders/gallery.svg'
};

/* ==========================================================================
   State
   ========================================================================== */

const GH_KEY = 'portfolio-editor.github';

const state = {
  content: null,
  baseline: '',              // JSON of the last published/loaded content
  page: 'home',              // 'home' or a project slug (what the preview shows)
  tab: 'home',               // sidebar tab
  pending: new Map(),        // new image path -> { blob }
  blobUrls: new Map(),       // new image path -> blob: URL for previewing
  openSecs: new Set(['hero']),
  openProjects: new WeakSet(),
  fx: false,                 // preview with live effects instead of click-to-edit
  gh: loadGh()
};

let bindings = []; // { el, obj, key } for every text input bound to content

function loadGh() {
  try { return JSON.parse(localStorage.getItem(GH_KEY)) || {}; } catch { return {}; }
}
function saveGh() { localStorage.setItem(GH_KEY, JSON.stringify(state.gh)); }
function ghReady() { const g = state.gh; return !!(g.owner && g.repo && g.token); }

function guessRepo() {
  const m = location.hostname.match(/^(.+)\.github\.io$/i);
  if (!m) return {};
  const owner = m[1];
  const seg = location.pathname.split('/').filter(Boolean);
  const repo = seg[0] && seg[0].toLowerCase() !== 'admin' ? seg[0] : `${owner}.github.io`;
  return { owner, repo };
}

function isDirty() {
  return state.pending.size > 0 || JSON.stringify(state.content) !== state.baseline;
}

function normalize(c) {
  c.meta ||= {}; c.meta.siteUrl ??= '';
  c.hero ||= {};
  c.marquee ||= [];
  c.projectsSection ||= { eyebrow: '', title: '' };
  c.projects ||= [];
  c.expertise ||= { eyebrow: '', title: '', items: [] };
  c.expertise.items ||= [];
  c.about ||= { eyebrow: '', paragraphs: [], buttonLabel: '' };
  c.about.paragraphs ||= [];
  c.contact ||= {};
  c.hero.badge ??= '';
  c.contact.headline ??= "Let's talk";
  c.contact.social ||= [];
  c.expertise.items.forEach((it) => { it.list ||= []; });
  c.projects.forEach((p) => {
    p.blocks ||= [];
    p.blocks.forEach((b) => { if (b.type === 'images') b.images ||= []; });
  });
  return c;
}

/* ==========================================================================
   Live preview
   ========================================================================== */

const iframe = $('#preview');
let previewTimer;
let restoreScroll = 0;
let pendingHash = '';

function renderPreview(keepScroll = true) {
  const c = state.content;
  // 'Edit' mode: plain text you can click and type into. 'Effects' mode: the real site, with the warp animations.
  const o = state.fx
    ? { fx: true, base: SITE_ROOT, resolve: (p) => state.blobUrls.get(p) }
    : { preview: true, base: SITE_ROOT, resolve: (p) => state.blobUrls.get(p) };
  let html;
  try {
    html = state.page === 'home' ? renderHome(c, o) : renderProject(c, state.page, o);
  } catch {
    state.page = 'home';
    html = renderHome(c, o);
  }
  if (keepScroll) {
    try { restoreScroll = iframe.contentWindow.scrollY || 0; } catch { restoreScroll = 0; }
  } else {
    restoreScroll = 0;
  }
  iframe.srcdoc = html;
}

iframe.addEventListener('load', () => {
  const w = iframe.contentWindow;
  if (!w) return;
  if (pendingHash) {
    const t = pendingHash === 'top' ? w.document.body : w.document.getElementById(pendingHash);
    t?.scrollIntoView();
    pendingHash = '';
  } else if (restoreScroll) {
    w.scrollTo({ top: restoreScroll, behavior: 'instant' });
  }
});

// Called whenever content changes from the sidebar.
function changed() {
  updateStatus();
  updateChrome();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => renderPreview(true), 250);
}

// Messages from inside the preview (in-place text editing, image replacing, navigation).
window.addEventListener('message', async (e) => {
  const d = e.data;
  if (e.source !== iframe.contentWindow || !d || d.source !== 'redactor') return;

  if (d.type === 'edit') {
    try { setPath(state.content, d.path, d.value); } catch { return; }
    updateStatus();
    updateChrome();
    syncForm();
  } else if (d.type === 'commit') {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => renderPreview(true), 200);
  } else if (d.type === 'image-picked') {
    try {
      const path = await addUpload(d.file);
      setPath(state.content, d.path, path);
      renderPanel();
      changed();
    } catch (err) {
      toast(err.message, 'err');
    }
  } else if (d.type === 'nav') {
    setPage(d.slug, d.hash || '');
  }
});

/* ==========================================================================
   Chrome: page selector, status, tabs
   ========================================================================== */

let selectSig = '';

function updateChrome() {
  const c = state.content;
  const sig = JSON.stringify([state.page, c.projects.map((p) => [p.slug, flat(p.name)])]);
  if (sig !== selectSig) {
    selectSig = sig;
    const sel = $('#page-select');
    sel.replaceChildren(
      h('option', { value: 'home' }, 'Home page'),
      ...c.projects.map((p) => h('option', { value: p.slug }, flat(p.name) || p.slug))
    );
    sel.value = state.page;
  }
  document.title = 'Site editor — ' + (c.hero.name || '');
}

function updateStatus() {
  const d = isDirty();
  const s = $('#status');
  s.textContent = d ? 'Unpublished changes' : 'All changes published';
  s.classList.toggle('dirty', d);
}

function setPage(slug, hash = '') {
  state.page = slug;
  state.tab = slug === 'home' ? 'home' : 'projects';
  if (slug !== 'home') {
    const p = state.content.projects.find((x) => x.slug === slug);
    if (p) state.openProjects.add(p);
  }
  pendingHash = hash;
  updateChrome();
  renderPanel();
  renderPreview(false);
}

$('#page-select').addEventListener('change', (e) => setPage(e.target.value));

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab;
  renderPanel();
});

$('#viewport').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vp]');
  if (!b) return;
  $('#frame-wrap').classList.toggle('mobile', b.dataset.vp === 'mobile');
  document.querySelectorAll('#viewport button').forEach((x) => x.classList.toggle('on', x === b));
});

$('#mode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  state.fx = b.dataset.mode === 'fx';
  document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x === b));
  renderPreview(true);
  toast(state.fx ? 'Effects mode: this is how visitors see it. Switch back to Edit to type in the preview.' : 'Edit mode: click any text to type, click any image to replace it.');
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

/* ==========================================================================
   Form building blocks
   ========================================================================== */

function syncForm() {
  bindings = bindings.filter((b) => b.el.isConnected);
  for (const b of bindings) {
    if (document.activeElement === b.el) continue;
    const v = b.obj[b.key] ?? '';
    if (b.el.value !== v) b.el.value = v;
  }
}

function field(label, input, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

function textField(obj, key, label, opts = {}) {
  const el = opts.area
    ? h('textarea', { rows: opts.rows || 3, placeholder: opts.placeholder })
    : h('input', { type: 'text', placeholder: opts.placeholder, autocomplete: 'off' });
  el.value = obj[key] ?? '';
  el.addEventListener('input', () => {
    if (opts.transform) el.value = opts.transform(el.value);
    obj[key] = el.value;
    opts.onInput?.(el.value);
    changed();
  });
  bindings.push({ el, obj, key });
  return field(label, el, opts.hint);
}

function selectField(obj, key, label, options) {
  const el = h('select', {}, options.map((o) => h('option', { value: o }, o)));
  el.value = obj[key];
  el.addEventListener('change', () => { obj[key] = el.value; changed(); });
  return field(label, el);
}

function checkField(obj, key, label, dflt = false) {
  const el = h('input', { type: 'checkbox' });
  el.checked = obj[key] === undefined ? dflt : !!obj[key];
  el.addEventListener('change', () => { obj[key] = el.checked; changed(); });
  return h('label', { class: 'check' }, el, label);
}

const btn = (label, onclick, cls = 'btn small') => h('button', { type: 'button', class: cls, onclick }, label);

function section(key, title, ...kids) {
  const d = h('details', { class: 'sec' }, h('summary', {}, title), h('div', { class: 'sec-body' }, ...kids));
  d.open = state.openSecs.has(key);
  d.addEventListener('toggle', () => { d.open ? state.openSecs.add(key) : state.openSecs.delete(key); });
  return d;
}

function move(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

// ↑ ↓ ✕ buttons for an item in an array. `redraw` re-renders the list.
function ctrls(arr, i, redraw, { min = 0, onDelete } = {}) {
  const go = (fn) => () => { fn(); redraw(); changed(); };
  return [
    h('button', { type: 'button', class: 'iconbtn', title: 'Move up', disabled: i === 0, onclick: go(() => move(arr, i, -1)) }, '↑'),
    h('button', { type: 'button', class: 'iconbtn', title: 'Move down', disabled: i === arr.length - 1, onclick: go(() => move(arr, i, 1)) }, '↓'),
    h('button', {
      type: 'button', class: 'iconbtn del', title: 'Remove', disabled: arr.length <= min,
      onclick: go(() => { onDelete ? onDelete() : arr.splice(i, 1); })
    }, '✕')
  ];
}

function stringList(arr, opts = {}) {
  const box = h('div');
  const draw = () => {
    const rows = arr.map((_, i) => {
      const input = opts.multiline
        ? h('textarea', { rows: 4, placeholder: opts.placeholder })
        : h('input', { type: 'text', placeholder: opts.placeholder, autocomplete: 'off' });
      input.value = arr[i];
      input.addEventListener('input', () => { arr[i] = input.value; changed(); });
      bindings.push({ el: input, obj: arr, key: i });
      return h('div', { class: 'row' }, input, ctrls(arr, i, draw, { min: opts.min || 0 }));
    });
    box.replaceChildren(
      h('div', { class: 'list' }, rows),
      btn('+ ' + (opts.add || 'Add'), () => { arr.push(''); draw(); changed(); })
    );
  };
  draw();
  return box;
}

/* ---------------------------------- Images -------------------------------- */

const srcUrl = (src) =>
  state.blobUrls.get(src) || (/^(https?:|data:|blob:|\/)/i.test(src) ? src : SITE_ROOT + src);

function thumb(src) {
  const t = h('div', { class: 'thumb' });
  if (src) t.style.backgroundImage = `url("${srcUrl(src)}")`;
  if (src && state.pending.has(src)) t.append(h('span', { class: 'new' }, 'New'));
  return t;
}

const picker = h('input', { type: 'file', accept: 'image/*', hidden: true });
document.body.append(picker);
function pickFiles(multiple) {
  return new Promise((resolve) => {
    picker.multiple = multiple;
    picker.value = '';
    picker.onchange = () => resolve([...picker.files]);
    picker.oncancel = () => resolve([]);
    picker.click();
  });
}

function hasAlpha(bmp) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, 64, 64);
  const d = cx.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

// Shrinks big photos (max 2400px), keeps transparency for PNGs, and registers the file for upload.
async function addUpload(file) {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" isn't an image.`);
  const MAX = 2400;
  let blob = file;
  let ext = (file.name.split('.').pop() || 'jpg').toLowerCase();

  if (file.type === 'image/svg+xml') ext = 'svg';
  else if (file.type === 'image/gif') ext = 'gif';
  else {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(() => createImageBitmap(file))
      .catch(() => null);
    if (!bmp) throw new Error(`Couldn't read "${file.name}". Please use a JPG, PNG or WebP.`);
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (file.type === 'image/jpeg' && scale === 1 && file.size <= 2.5 * 1024 * 1024) {
      ext = 'jpg'; // already small enough — keep the original bytes
    } else {
      const w = Math.round(bmp.width * scale);
      const hh = Math.round(bmp.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = hh;
      const cx = cv.getContext('2d');
      const alpha = file.type !== 'image/jpeg' && hasAlpha(bmp);
      if (!alpha) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, hh); }
      cx.drawImage(bmp, 0, 0, w, hh);
      blob = await new Promise((r) => cv.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.86));
      ext = alpha ? 'png' : 'jpg';
    }
    bmp.close?.();
  }

  const base = file.name.replace(/\.[^.]+$/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
  const path = `images/uploads/${base}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  state.pending.set(path, { blob });
  state.blobUrls.set(path, URL.createObjectURL(blob));
  return path;
}

function imageField(obj, key, label, altKey) {
  const box = h('div', { class: 'field' });
  const draw = () => {
    const pick = async () => {
      const [f] = await pickFiles(false);
      if (!f) return;
      try { obj[key] = await addUpload(f); } catch (err) { return toast(err.message, 'err'); }
      draw(); changed();
    };
    box.replaceChildren(
      h('span', { class: 'lbl' }, label),
      h('div', { class: 'imgrow' },
        thumb(obj[key]),
        h('div', { class: 'imgbtns' },
          btn(obj[key] ? 'Replace' : 'Choose image', pick),
          obj[key] ? btn('Remove', () => { obj[key] = ''; draw(); changed(); }) : null)),
      altKey ? textField(obj, altKey, 'Image description (for screen readers)', {}) : null
    );
  };
  draw();
  return box;
}

/* ==========================================================================
   Sidebar tabs
   ========================================================================== */

function renderPanel() {
  const body = $('#panel-body');
  const top = body.scrollTop;
  bindings = [];
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));

  const tip = h('div', { class: 'tip' },
    h('b', {}, 'Tip: '), 'in Edit mode, click any text in the preview to type over it and any image to replace it. Switch to Effects to see the animated headlines. Use this panel to add, remove or reorder things.');

  const content = { home: homeTab, projects: projectsTab, site: siteTab }[state.tab]();
  body.replaceChildren(...(state.tab === 'site' ? [] : [tip]), ...content);
  body.scrollTop = top;
}

/* ---------------------------------- Home ---------------------------------- */

function homeTab() {
  const c = state.content;
  return [
    section('hero', 'Hero',
      textField(c.hero, 'eyebrow', 'Small label'),
      textField(c.hero, 'name', 'Name'),
      textField(c.hero, 'text', 'Intro text', { area: true, rows: 4 }),
      textField(c.hero, 'ctaLabel', 'Link text'),
      textField(c.hero, 'badge', 'Circular text', { hint: 'Spins around the arrow button beside the headline. Leave empty to hide it.' }),
      imageField(c.hero, 'image', 'Photo', 'imageAlt'),
      checkField(c.hero, 'imageGrayscale', 'Show photo in black & white', true)),

    section('marquee', 'Scrolling tags',
      stringList(c.marquee, { add: 'Add tag', placeholder: 'e.g. Brand Identity' })),

    section('projhead', 'Projects heading',
      textField(c.projectsSection, 'eyebrow', 'Small label'),
      textField(c.projectsSection, 'title', 'Heading'),
      h('p', { class: 'hint' }, 'The projects themselves are managed in the Projects tab.')),

    section('expertise', 'Expertise',
      textField(c.expertise, 'eyebrow', 'Small label'),
      textField(c.expertise, 'title', 'Heading'),
      h('div', { class: 'sub' }, 'Categories'),
      expertiseEditor()),

    section('about', 'About',
      textField(c.about, 'eyebrow', 'Left-hand text', { area: true, rows: 3 }),
      h('div', { class: 'sub' }, 'Paragraphs'),
      stringList(c.about.paragraphs, { multiline: true, add: 'Add paragraph' }),
      textField(c.about, 'buttonLabel', 'Button text')),

    section('contact', 'Contact & social',
      textField(c.contact, 'headline', 'Giant headline', { hint: 'The huge link above the contact details. It opens an email to the address below.' }),
      textField(c.contact, 'inquiryLabel', 'Small label above it'),
      textField(c.contact, 'email', 'Email address'),
      textField(c.contact, 'locationLabel', 'Location label'),
      textField(c.contact, 'location', 'Location'),
      textField(c.contact, 'socialLabel', 'Social label'),
      h('div', { class: 'sub' }, 'Social links'),
      socialEditor())
  ];
}

function expertiseEditor() {
  const items = state.content.expertise.items;
  const box = h('div');
  const draw = () => {
    box.replaceChildren(
      ...items.map((it, i) => h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('b', {}, `Category ${i + 1}`), ctrls(items, i, draw)),
        textField(it, 'title', 'Title'),
        selectField(it, 'icon', 'Icon', Object.keys(EXPERTISE_ICONS)),
        h('span', { class: 'lbl' }, 'Lines'),
        stringList(it.list, { add: 'Add line' }))),
      btn('+ Add category', () => {
        items.push({ title: 'New category', icon: 'spark', list: ['First item'] });
        draw(); changed();
      })
    );
  };
  draw();
  return box;
}

function socialEditor() {
  const list = state.content.contact.social;
  const box = h('div');
  const draw = () => {
    box.replaceChildren(
      ...list.map((s, i) => h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('b', {}, s.label || `Link ${i + 1}`), ctrls(list, i, draw)),
        h('div', { class: 'grid2' },
          selectField(s, 'icon', 'Icon', Object.keys(SOCIAL_ICONS)),
          textField(s, 'label', 'Name')),
        textField(s, 'url', 'Link', { placeholder: 'https://…' }))),
      btn('+ Add link', () => {
        list.push({ icon: 'link', label: '', url: '' });
        draw(); changed();
      })
    );
  };
  draw();
  return box;
}

/* -------------------------------- Projects -------------------------------- */

function projectsTab() {
  const c = state.content;
  const box = h('div');
  const draw = () => {
    box.replaceChildren(
      ...c.projects.map((p, i) => projectCard(p, i, draw)),
      h('div', { class: 'actions' }, btn('+ Add project', addProject, 'btn primary small'))
    );
  };
  draw();
  return [
    h('p', { class: 'muted' }, 'Each project has a card on the home page and its own page. The order here is the order on the site.'),
    box
  ];
}

function projectCard(p, i, redrawAll) {
  const c = state.content;
  const titleEl = h('span', {}, flat(p.name) || 'Untitled');
  const det = h('details', { class: 'sec' }, h('summary', {}, titleEl, h('span', { class: 'muted' }, p.year)));
  det.open = state.openProjects.has(p);
  det.addEventListener('toggle', () => { det.open ? state.openProjects.add(p) : state.openProjects.delete(p); });

  let lastSlug = p.slug;
  const body = h('div', { class: 'sec-body' },
    h('div', { class: 'actions' },
      btn('View page', () => setPage(p.slug)),
      btn('Move up', () => { move(c.projects, i, -1); redrawAll(); changed(); }),
      btn('Move down', () => { move(c.projects, i, 1); redrawAll(); changed(); }),
      btn('Delete', () => {
        if (!confirm(`Delete "${flat(p.name)}"? This removes its card and its page when you publish.`)) return;
        c.projects.splice(i, 1);
        if (state.page === p.slug) { state.page = 'home'; renderPreview(false); }
        redrawAll(); changed();
      }, 'btn small danger')),
    h('div', { class: 'sub' }, 'Details'),
    textField(p, 'name', 'Project name', {
      area: true, rows: 2, hint: 'Press Enter for a second line.',
      onInput: (v) => { titleEl.textContent = flat(v) || 'Untitled'; }
    }),
    textField(p, 'category', 'Category label', { placeholder: 'BRAND IDENTITY' }),
    h('div', { class: 'grid2' },
      textField(p, 'year', 'Year (card)'),
      textField(p, 'yearRange', 'Year (page)')),
    textField(p, 'services', 'Services'),
    textField(p, 'brief', 'Short brief', { area: true, rows: 3 }),
    textField(p, 'slug', 'Page address', {
      hint: 'Becomes work/<address>.html — letters, numbers and dashes only.',
      transform: (v) => v.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
      onInput: (v) => { if (state.page === lastSlug) state.page = v; lastSlug = v; }
    }),
    h('div', { class: 'sub' }, 'Images'),
    imageField(p, 'cover', 'Cover image (follows the cursor on the project list; shown in the list on phones)', 'coverAlt'),
    imageField(p, 'background', 'Banner image (wide, across the top of the project page)'),
    h('div', { class: 'sub' }, 'Page content'),
    blocksEditor(p)
  );
  det.append(body);
  return det;
}

function blocksEditor(p) {
  const box = h('div');
  const draw = () => {
    box.replaceChildren(
      ...p.blocks.map((b, j) => h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('b', {}, b.type === 'text' ? 'Text' : `Images (${b.images.length})`),
          ctrls(p.blocks, j, draw)),
        b.type === 'text'
          ? textField(b, 'text', '', { area: true, rows: 5, placeholder: 'Write a paragraph…' })
          : gallery(b, () => { if (!b.images.length) p.blocks.splice(j, 1); draw(); changed(); }, draw))),
      h('div', { class: 'actions' },
        btn('+ Text', () => { p.blocks.push({ type: 'text', text: '' }); draw(); changed(); }),
        btn('+ Images', async () => {
          const files = await pickFiles(true);
          if (!files.length) return;
          const images = [];
          for (const f of files) {
            try { images.push({ src: await addUpload(f), alt: '' }); } catch (err) { toast(err.message, 'err'); }
          }
          if (!images.length) return;
          p.blocks.push({ type: 'images', images });
          draw(); changed();
        }))
    );
  };
  draw();
  return box;
}

// One row of images inside a project page. 1 image = full width, 2 = side by side, 3 = three across.
function gallery(b, afterRemove, redraw) {
  const wrap = h('div');
  wrap.append(
    h('div', { class: 'gallery' }, b.images.map((im, k) => {
      const alt = h('input', { type: 'text', placeholder: 'Description (optional)', autocomplete: 'off' });
      alt.value = im.alt || '';
      alt.addEventListener('input', () => { im.alt = alt.value; changed(); });
      const go = (fn) => () => { fn(); redraw(); changed(); };
      return h('div', { class: 'g' },
        thumb(im.src), alt,
        h('div', { class: 'tight' },
          h('button', { type: 'button', class: 'iconbtn', title: 'Move left', disabled: k === 0, onclick: go(() => move(b.images, k, -1)) }, '←'),
          h('button', { type: 'button', class: 'iconbtn', title: 'Move right', disabled: k === b.images.length - 1, onclick: go(() => move(b.images, k, 1)) }, '→'),
          h('button', { type: 'button', class: 'iconbtn del', title: 'Remove', onclick: () => { b.images.splice(k, 1); afterRemove(); } }, '✕')));
    })),
    h('div', { class: 'actions' }, btn('+ Add images to this row', async () => {
      const files = await pickFiles(true);
      for (const f of files) {
        try { b.images.push({ src: await addUpload(f), alt: '' }); } catch (err) { toast(err.message, 'err'); }
      }
      if (files.length) { redraw(); changed(); }
    }))
  );
  return wrap;
}

function addProject() {
  const c = state.content;
  let slug = 'new-project';
  let n = 2;
  while (c.projects.some((p) => p.slug === slug)) slug = `new-project-${n++}`;
  const y = String(new Date().getFullYear());
  const p = {
    slug, name: 'New Project', category: 'BRAND IDENTITY', year: y, yearRange: y,
    background: PLACEHOLDER.wide, cover: PLACEHOLDER.cover, coverAlt: '',
    services: '', brief: '',
    blocks: [
      { type: 'text', text: 'Tell the story of this project here.' },
      { type: 'images', images: [{ src: PLACEHOLDER.gallery, alt: '' }] }
    ]
  };
  c.projects.push(p);
  setPage(slug);
  changed();
}

/* ----------------------------------- Site --------------------------------- */

function siteTab() {
  const c = state.content;
  const restore = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  restore.addEventListener('change', async () => {
    const f = restore.files[0];
    if (!f) return;
    try {
      state.content = normalize(JSON.parse(await f.text()));
      state.page = 'home';
      selectSig = '';
      renderAll();
      changed();
      toast('Backup loaded. Publish to make it live.', 'ok');
    } catch { toast("That file isn't a valid backup.", 'err'); }
  });

  return [
    section('seo', 'Site & search', 
      textField(c.meta, 'title', 'Browser tab / Google title'),
      textField(c.meta, 'description', 'Description for Google', { area: true, rows: 3 }),
      textField(c.meta, 'logoMark', 'Logo letter', { hint: 'The orange letter at the top left.' }),
      textField(c.meta, 'siteUrl', 'Website address', {
        placeholder: 'https://yourname.github.io/portfolio/',
        hint: 'Used for link previews. Filled in automatically on first publish; change it if you add a custom domain.'
      }),
      imageField(c.meta, 'ogImage', 'Link-preview image (1200 × 630 works best)'),
      imageField(c.meta, 'favicon', 'Favicon (browser tab icon)')),
    section('backup', 'Backup',
      h('p', { class: 'muted' }, 'Everything you edit lives in one file, content/site.json. Download a copy any time.'),
      h('div', { class: 'actions' },
        btn('Download backup', downloadBackup),
        btn('Restore from backup…', () => restore.click()),
        restore)),
    h('div', { class: 'actions' },
      btn(ghReady() ? `GitHub: ${state.gh.owner}/${state.gh.repo}` : 'Connect to GitHub…', openSettings, 'btn small'))
  ];
}

function downloadBackup() {
  const blob = new Blob([JSON.stringify(state.content, null, 2) + '\n'], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'site-content.json' });
  document.body.append(a);
  a.click();
  a.remove();
}

/* ==========================================================================
   GitHub
   ========================================================================== */

async function gh(path, { method = 'GET', body, raw } = {}) {
  const { owner, repo, token } = state.gh;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const err = new Error(j.message || res.statusText);
    err.status = res.status;
    throw err;
  }
  if (raw) return res.text();
  return res.status === 204 ? null : res.json();
}

function friendly(e) {
  if (e.status === 401) return 'GitHub rejected the token — it may be mistyped or expired.';
  if (e.status === 403) return 'The token isn’t allowed to do that. Give it “Contents: Read and write” for this repository.';
  if (e.status === 404) return 'Repository or branch not found. Check the owner, repository and branch names, and that the token can access this repository.';
  if (e.status === 409 || e.status === 422) return `GitHub couldn’t save the change (${e.message}). Reload the editor and try again.`;
  if (e instanceof TypeError) return 'Couldn’t reach GitHub. Check your internet connection.';
  return e.message;
}

function liveUrl() {
  if (state.content.meta.siteUrl) return state.content.meta.siteUrl;
  const { owner, repo } = state.gh;
  if (!owner || !repo) return '';
  return `https://${owner}.github.io/${repo.toLowerCase() === `${owner}.github.io`.toLowerCase() ? '' : repo + '/'}`;
}

/* -------- Settings dialog -------- */

const sDlg = $('#settings-dlg');
$('#settings-form').addEventListener('submit', (e) => e.preventDefault());

function showResult(el, msg, cls) {
  el.hidden = !msg;
  el.className = 'result ' + (cls || '');
  el.textContent = msg || '';
}

function openSettings(message) {
  const g = { ...guessRepo(), ...state.gh };
  $('#gh-owner').value = g.owner || '';
  $('#gh-repo').value = g.repo || '';
  $('#gh-branch').value = g.branch || 'main';
  $('#gh-token').value = state.gh.token || '';
  showResult($('#gh-result'), typeof message === 'string' ? message : '', '');
  sDlg.showModal();
}

$('#btn-settings').addEventListener('click', () => openSettings());
$('#gh-close').addEventListener('click', () => sDlg.close());
$('#gh-forget').addEventListener('click', () => {
  delete state.gh.token;
  saveGh();
  $('#gh-token').value = '';
  showResult($('#gh-result'), 'Token removed from this browser.', 'ok');
  if (state.tab === 'site') renderPanel();
});
$('#gh-save').addEventListener('click', async () => {
  state.gh = {
    owner: $('#gh-owner').value.trim(),
    repo: $('#gh-repo').value.trim(),
    branch: $('#gh-branch').value.trim() || 'main',
    token: $('#gh-token').value.trim()
  };
  saveGh();
  const out = $('#gh-result');
  if (!ghReady()) return showResult(out, 'Fill in the owner, repository and token.', 'err');
  showResult(out, 'Testing…', '');
  try {
    const repo = await gh('');
    if (repo.permissions && !repo.permissions.push) {
      return showResult(out, 'Connected, but this token can only read. It needs “Contents: Read and write”.', 'err');
    }
    showResult(out, `Connected to ${repo.full_name} ✓`, 'ok');
    if (state.tab === 'site') renderPanel();
    if (!isDirty()) {
      const latest = await loadRemoteContent();
      if (latest && JSON.stringify(latest) !== state.baseline) {
        state.content = latest;
        state.baseline = JSON.stringify(latest);
        selectSig = '';
        renderAll();
        toast('Loaded the latest version from GitHub.', 'ok');
      }
    }
  } catch (e) {
    showResult(out, friendly(e), 'err');
  }
});

/* -------- Publish -------- */

const pDlg = $('#publish-dlg');
$('#publish-form').addEventListener('submit', (e) => e.preventDefault());
$('#pub-close').addEventListener('click', () => pDlg.close());
$('#btn-publish').addEventListener('click', openPublish);

function validate() {
  const c = state.content;
  const seen = new Set();
  for (const p of c.projects) {
    if (!p.slug || !/^[a-z0-9-]+$/.test(p.slug)) return `"${flat(p.name) || 'A project'}" needs a page address (letters, numbers, dashes).`;
    if (seen.has(p.slug)) return `Two projects share the page address “${p.slug}”. Make each one different.`;
    seen.add(p.slug);
  }
  if (!c.hero.name?.trim()) return 'The hero needs a name.';
  return '';
}

function openPublish() {
  const problem = validate();
  if (problem) { state.tab = 'projects'; renderPanel(); return toast(problem, 'err'); }
  if (!ghReady()) return openSettings('Add your GitHub details first, then press Publish again.');

  const nPages = 1 + state.content.projects.length;
  const nImgs = pendingImagePaths().length;
  $('#pub-title').textContent = 'Publish changes';
  $('#pub-summary').textContent =
    `This updates your website (${nPages} page${nPages > 1 ? 's' : ''}` +
    (nImgs ? `, ${nImgs} new image${nImgs > 1 ? 's' : ''}` : '') +
    `) and saves your content in ${state.gh.owner}/${state.gh.repo}. GitHub Pages shows the change about a minute later.`;
  $('#pub-msg-field').hidden = false;
  $('#pub-log').hidden = true;
  $('#pub-log').replaceChildren();
  showResult($('#pub-result'), '');
  $('#pub-go').hidden = false;
  $('#pub-go').disabled = false;
  $('#pub-close').textContent = 'Cancel';
  pDlg.showModal();
}

function pendingImagePaths() {
  const json = JSON.stringify(state.content);
  return [...state.pending.keys()].filter((p) => json.includes(p));
}

async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

$('#pub-go').addEventListener('click', async () => {
  const go = $('#pub-go');
  const logEl = $('#pub-log');
  const say = (t) => { logEl.hidden = false; logEl.replaceChildren(h('li', {}, t)); };
  go.disabled = true;
  $('#pub-msg-field').hidden = true;
  showResult($('#pub-result'), '');

  try {
    const { branch = 'main' } = state.gh;
    const c = state.content;
    if (!c.meta.siteUrl) c.meta.siteUrl = liveUrl();

    // Everything that changes, as files. Two groups:
    //   - your workshop copy:  content/site.json and uploaded originals in images/uploads/
    //   - the public website:  docs/  (this is the only folder GitHub Pages serves)
    const files = [{ path: 'content/site.json', text: JSON.stringify(c, null, 2) + '\n' }];
    const pages = renderSite(c);
    pages.forEach((pg) => files.push({ path: 'docs/' + pg.path, text: pg.html }));
    for (const path of pendingImagePaths()) {
      const b64 = await toBase64(state.pending.get(path).blob);
      files.push({ path, base64: b64 });            // workshop copy
      files.push({ path: 'docs/' + path, base64: b64 }); // public copy
    }

    // 1. Read the current state of the branch.
    say('Connecting to GitHub…');
    const ref = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const parentSha = ref.object.sha;
    const parent = await gh(`/git/commits/${parentSha}`);
    const tree = await gh(`/git/trees/${parent.tree.sha}?recursive=1`);

    // 2. Upload each file.
    const entries = [];
    for (let i = 0; i < files.length; i++) {
      say(`Uploading file ${i + 1} of ${files.length}…`);
      const f = files[i];
      const blob = await gh('/git/blobs', {
        method: 'POST',
        body: f.base64 != null ? { content: f.base64, encoding: 'base64' } : { content: f.text, encoding: 'utf-8' }
      });
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    // 3. Remove pages of projects that were deleted or renamed.
    const keep = new Set(pages.map((pg) => 'docs/' + pg.path));
    tree.tree
      .filter((t) => t.type === 'blob' && /^docs\/work\/[^/]+\.html$/.test(t.path) && !keep.has(t.path))
      .forEach((t) => entries.push({ path: t.path, mode: '100644', type: 'blob', sha: null }));

    // 4. One commit for everything.
    say('Saving…');
    const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: entries } });
    const msg = $('#pub-msg').value.trim() || 'Update site content';
    const commit = await gh('/git/commits', {
      method: 'POST', body: { message: msg + ' (via site editor)', tree: newTree.sha, parents: [parentSha] }
    });
    await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });

    // 5. Done.
    state.baseline = JSON.stringify(state.content);
    state.pending.clear();
    updateStatus();
    if (state.tab === 'site') renderPanel();
    logEl.hidden = true;
    $('#pub-title').textContent = 'Published ✓';
    const res = $('#pub-result');
    res.hidden = false;
    res.className = 'result ok';
    res.replaceChildren(
      'Saved. GitHub Pages usually shows the change within a minute or two. ',
      h('a', { href: liveUrl() || '#', target: '_blank', rel: 'noopener' }, 'Open the live site ↗')
    );
    go.hidden = true;
    $('#pub-close').textContent = 'Done';
  } catch (e) {
    console.error(e);
    logEl.hidden = true;
    showResult($('#pub-result'), friendly(e), 'err');
    go.disabled = false;
    $('#pub-msg-field').hidden = false;
  }
});

/* ==========================================================================
   Boot
   ========================================================================== */

async function loadRemoteContent() {
  if (!ghReady()) return null;
  try {
    const t = await gh(`/contents/content/site.json?ref=${encodeURIComponent(state.gh.branch || 'main')}`, { raw: true });
    return normalize(JSON.parse(t));
  } catch (e) {
    console.warn('Could not read content from GitHub:', e);
    return null;
  }
}

async function loadContent() {
  // Prefer the newest copy on GitHub (the deployed site can lag a minute or two behind).
  const remote = await loadRemoteContent();
  if (remote) return remote;
  const res = await fetch(new URL('content/site.json', SITE_ROOT), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return normalize(await res.json());
}

function renderAll() {
  updateChrome();
  updateStatus();
  renderPanel();
  renderPreview(false);
}

(async function init() {
  try {
    state.content = await loadContent();
    state.baseline = JSON.stringify(state.content);
    renderAll();
  } catch (e) {
    $('#panel-body').replaceChildren(
      h('div', { class: 'tip' },
        h('b', {}, 'Couldn’t load content/site.json. '),
        'Open this editor from a web address (your GitHub Pages site, or “python3 -m http.server” locally) rather than double-clicking the file.',
        h('br'), h('small', {}, String(e.message || e))));
  }
})();
