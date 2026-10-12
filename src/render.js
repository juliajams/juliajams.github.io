// ---------------------------------------------------------------------------
// render.js — turns content/site.json into finished HTML pages.
//
// This file is deliberately environment-neutral (no Node or DOM APIs), so the
// exact same code runs in two places:
//   1. build.mjs   (Node)    → writes index.html + work/*.html
//   2. admin/      (browser) → live preview, and the files it publishes to GitHub
// ---------------------------------------------------------------------------

/* ------------------------------ Icon library ------------------------------ */

// Inner SVG markup, drawn on a 24×24 grid with currentColor strokes.
export const EXPERTISE_ICONS = {
  target: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/>',
  shapes: '<path d="M5 20 9 6l4 14Z" stroke-linejoin="round"/><circle cx="16.5" cy="8" r="2.6"/><rect x="13" y="14" width="7" height="6"/>',
  pen: '<path d="M4 20l4-1L19 8l-3-3L5 16l-1 4z" stroke-linejoin="round"/><path d="M14 7l3 3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z" stroke-linejoin="round"/><path d="M3 13l9 5 9-5" stroke-linejoin="round"/>',
  spark: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" stroke-linecap="round"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'
};

export const SOCIAL_ICONS = {
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
  dribbble: '<circle cx="12" cy="12" r="9"/><path d="M4 9c4 1.3 12 1.3 16 0M6 19c2-5 4-10 4-16M18 19c-2-5-6-8-14-8"/>',
  behance: '<rect x="2" y="7" width="9" height="10" rx="1.5"/><path d="M13 10.5h7M13.5 17c1.5 1 5.5 1 6.5-1.5s-1-3-2.5-3-3 .8-3 2.5.8 3 3 3c1.2 0 2-.4 2.5-1"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10.5V16M8 7.5v.01M12 16v-5.5M12 12.5c0-1.4 1-2.5 2.5-2.5S17 11 17 12.5V16"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
};

/* -------------------------------- Helpers --------------------------------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const ml = (s) => esc(s).replace(/\r?\n/g, '<br>');          // escape + keep line breaks
export const flat = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim(); // single-line version
const stroke = (inner, w = 1.4) =>
  `<g fill="none" stroke="currentColor" stroke-width="${w}">${inner}</g>`;

function safeUrl(u) {
  u = String(u ?? '').trim();
  if (!u) return '#';
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(u)) return u;
  return 'https://' + u;
}

// Turn a path stored in content ("images/x.jpg") into a usable URL.
function asset(p, root, o) {
  if (!p) return '';
  if (o.resolve) { const r = o.resolve(p); if (r) return r; }
  return /^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(p) ? p : root + p;
}

// Attribute that makes an element click-to-edit inside the editor preview.
const ed = (o, path, multiline) =>
  o.preview ? ` data-edit="${path}"${multiline ? ' data-ml' : ''}` : '';

function img(o, root, { src, alt, path, cls, eager }) {
  if (!src) {
    return o.preview && path
      ? `<button type="button" class="img-empty${cls ? ' ' + cls : ''}" data-edit-img="${path}">+ Add image</button>`
      : '';
  }
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(asset(src, root, o))}" alt="${esc(alt || '')}"` +
    `${eager ? '' : ' loading="lazy" decoding="async"'}${o.preview && path ? ` data-edit-img="${path}"` : ''}>`;
}

const arrowIcon =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ------------------------------ Shared pieces ----------------------------- */

function head(c, o, { root, title, description, pathname, ogImage }) {
  const site = String(c.meta.siteUrl || '').replace(/\/?$/, '/');
  const abs = (p) => (c.meta.siteUrl && p && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(p) ? site + p.replace(/^\//, '') : p);
  const ogImg = ogImage ? abs(ogImage) : '';
  const fav = c.meta.favicon ? asset(c.meta.favicon, root, o) : '';
  return `<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${o.preview && o.base ? `<base href="${esc(o.base)}">\n` : ''}<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0c0c0b">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}">\n` : ''}${c.meta.siteUrl ? `<meta property="og:url" content="${esc(site + pathname)}">\n<link rel="canonical" href="${esc(site + pathname)}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
${fav ? `<link rel="icon" href="${esc(fav)}">\n` : ''}<link rel="preload" href="${root}fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${root}fonts/dm-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${root}css/style.css">
<noscript><style>.reveal{opacity:1!important;transform:none!important}</style></noscript>${o.preview ? `\n<style>${PREVIEW_CSS}</style>` : ''}
</head>`;
}

function header(c, o, root, home) {
  const idx = home ? '' : `${root}index.html`;
  return `<header class="site-header">
  <div class="wrap">
    <a href="${home ? '#top' : idx || 'index.html'}" class="brand">${esc(c.meta.logoMark || 'y')}</a>
    <nav class="main-nav" id="main-nav" aria-label="Main">
      <ul>
        <li><a href="${idx}#about">About</a></li>
        <li><a href="${idx}#works">Work</a></li>
        <li><a href="${idx}#services">Expertise</a></li>
        <li><a href="${idx}#contact">Contact</a></li>
      </ul>
    </nav>
    <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="main-nav">
      <span></span><span></span>
    </button>
  </div>
</header>`;
}

function footer(c, o, root, home) {
  const idx = home ? '' : `${root}index.html`;
  const year = o.year || new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="wrap footer-row">
    <span>&copy; <span data-year>${year}</span> ${esc(c.hero.name)}</span>
    <nav aria-label="Footer">
      <ul>
        <li><a href="${idx}#about">About</a></li>
        <li><a href="${idx}#services">Services</a></li>
        <li><a href="${idx}#contact">Contact</a></li>
      </ul>
    </nav>
    <a href="#top" class="to-top" aria-label="Back to top">
      <svg viewBox="0 0 24 24" fill="none"><path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>
  </div>
</footer>`;
}

function pageShell(c, o, { root, home, title, description, pathname, ogImage, body }) {
  return `<!DOCTYPE html>
<html lang="en">
${head(c, o, { root, title, description, pathname, ogImage })}
<body id="top">

${header(c, o, root, home)}

<main>
${body}
</main>

${footer(c, o, root, home)}

<script src="${root}js/main.js"></script>${o.preview ? `\n<script>${PREVIEW_SCRIPT}</script>` : ''}
</body>
</html>
`;
}

/* -------------------------------- Home page ------------------------------- */

function workRow(c, o, p, i) {
  const root = '';
  const href = `work/${esc(p.slug)}.html`;
  const P = `projects.${i}`;
  const text = `<div class="work-row-text">
            <div>
              <span class="eyebrow work-cat"${ed(o, `${P}.category`)}>${esc(p.category)}</span>
              <h3 class="work-name"${ed(o, `${P}.name`, true)}>${ml(p.name)}</h3>
            </div>
            <div class="work-row-meta">
              <span class="work-year"${ed(o, `${P}.year`)}>${esc(p.year)}</span>
              <span class="arrow-btn">${arrowIcon}</span>
            </div>
          </div>`;
  const sun = p.sunburst
    ? `\n              <svg class="work-row-sunburst" viewBox="0 0 60 60" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M30 0v14M30 46v14M0 30h14M46 30h14M8 8l10 10M42 42l10 10M52 8L42 18M18 42L8 52"/></g></svg>`
    : '';
  const visual = `<div class="work-row-visual">
            ${img(o, root, { src: p.background, alt: '', path: `${P}.background`, cls: 'work-row-bg' })}
            <div class="work-row-frame">
              ${img(o, root, { src: p.cover, alt: p.coverAlt || flat(p.name), path: `${P}.cover` })}
              <span class="frame-title"><span class="frame-title-text"${ed(o, `${P}.frameTitle`, true)} style="pointer-events:auto">${ml(p.frameTitle)}</span></span>${sun}
            </div>
          </div>`;
  return `      <a class="work-row${i % 2 ? ' flip' : ''} reveal" href="${href}">
        <div class="wrap work-row-grid">
          ${text}
          ${visual}
        </div>
      </a>`;
}

export function renderHome(c, o = {}) {
  const root = '';
  const h = c.hero;
  const tags = c.marquee.filter(Boolean);
  const half = tags.length ? Array.from({ length: Math.max(1, Math.ceil(12 / tags.length)) }, () => tags).flat() : [];
  const track = [...half, ...half].map((t) => `<span>${esc(t)}</span>`).join('');

  const social = c.contact.social
    .filter((s) => s.url)
    .map((s) => `          <a class="social-btn" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" aria-label="${esc(s.label || s.icon)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SOCIAL_ICONS[s.icon] || SOCIAL_ICONS.link}</svg>
          </a>`)
    .join('\n');

  const expertise = c.expertise.items
    .map((it, i) => `      <div class="expertise-row reveal">
       <div class="wrap expertise-row-grid">
        <div>
          <h3${ed(o, `expertise.items.${i}.title`)}>${esc(it.title)}</h3>
          <svg class="expertise-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXPERTISE_ICONS[it.icon] || EXPERTISE_ICONS.target}</svg>
        </div>
        <ul>
${it.list.map((li, j) => `          <li${ed(o, `expertise.items.${i}.list.${j}`)}>${esc(li)}</li>`).join('\n')}
        </ul>
       </div>
      </div>`)
    .join('\n\n');

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: h.name,
    jobTitle: flat(h.eyebrow).replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase()).replace('Ux', 'UX'),
    email: 'mailto:' + c.contact.email,
    ...(c.meta.siteUrl ? { url: c.meta.siteUrl } : {}),
    sameAs: c.contact.social.filter((s) => /^https?:/i.test(s.url || '')).map((s) => s.url)
  };
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c');

  const body = `  <section id="hero" class="hero">
    <div class="wrap hero-grid">
      <div class="hero-id">
        <h1 class="hero-title"${ed(o, 'hero.name')}>${esc(h.name)}</h1>
        <p class="hero-role"${ed(o, 'hero.eyebrow')}>${esc(h.eyebrow)}</p>
      </div>
      <div class="hero-portrait${h.imageGrayscale === false ? ' is-color' : ''} reveal">
        <span class="accent-tab" aria-hidden="true"></span>
        ${img(o, root, { src: h.image, alt: h.imageAlt, path: 'hero.image', eager: true })}
      </div>
      <div class="hero-copy reveal">
        <p${ed(o, 'hero.text')}>${esc(h.text)}</p>
        <a href="#works" class="link-cta"><span${ed(o, 'hero.ctaLabel')}>${esc(h.ctaLabel)}</span> <span class="arrow">&rarr;</span></a>
      </div>
    </div>
  </section>

  ${tags.length ? `<div class="marquee-section" aria-hidden="true">
    <div class="marquee-track">${track}</div>
  </div>` : ''}

  ${h.ghost ? `<div class="hero-ghost" aria-hidden="true"><span${ed(o, 'hero.ghost')}>${esc(h.ghost)}</span></div>` : ''}

  <section id="works">
    <div class="wrap section-band">
      <div class="section-head reveal">
        <span class="eyebrow"${ed(o, 'projectsSection.eyebrow')}>${esc(c.projectsSection.eyebrow)}</span>
        <h2 class="section-title"${ed(o, 'projectsSection.title')}>${esc(c.projectsSection.title)}</h2>
        <svg class="nav-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 1.5v21M1.5 12h21M4.6 4.6l14.8 14.8M19.4 4.6L4.6 19.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </div>
    </div>

    <div class="work-list">
${c.projects.map((p, i) => workRow(c, o, p, i)).join('\n\n')}
    </div>
  </section>

  <section id="services" class="expertise-section">
    <div class="wrap expertise-head reveal">
      <div>
        <span class="eyebrow"${ed(o, 'expertise.eyebrow')}>${esc(c.expertise.eyebrow)}</span>
        <h2 class="section-title"${ed(o, 'expertise.title')}>${esc(c.expertise.title)}</h2>
      </div>
      <svg class="expertise-ring" viewBox="0 0 480 250" fill="none" aria-hidden="true">
        <defs><linearGradient id="ringfade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5127" stop-opacity="0"/><stop offset=".45" stop-color="#ff5127" stop-opacity=".45"/><stop offset="1" stop-color="#ff5127"/></linearGradient></defs>
        <ellipse cx="240" cy="125" rx="228" ry="112" stroke="url(#ringfade)" stroke-width="4"/>
      </svg>
    </div>

    <div class="expertise-list">
${expertise}
    </div>
  </section>

  <section id="about" class="about-section">
    <div class="wrap about-grid">
      <div class="reveal">
        <p class="eyebrow"${ed(o, 'about.eyebrow', true)}>${ml(c.about.eyebrow)}</p>
      </div>
      <div class="about-copy reveal">
${c.about.paragraphs.map((t, i) => `        <p${ed(o, `about.paragraphs.${i}`)}>${esc(t)}</p>`).join('\n')}
        <a href="#works" class="btn-pill"><span${ed(o, 'about.buttonLabel')}>${esc(c.about.buttonLabel)}</span></a>
      </div>
    </div>
  </section>

  <section id="contact" class="contact-section">
    <div class="wrap contact-grid">
      <div class="contact-col reveal">
        <h4${ed(o, 'contact.inquiryLabel')}>${esc(c.contact.inquiryLabel)}</h4>
        <a href="mailto:${esc(c.contact.email)}"${ed(o, 'contact.email')}>${esc(c.contact.email)}</a>
      </div>
      <div class="contact-col reveal">
        <h4${ed(o, 'contact.locationLabel')}>${esc(c.contact.locationLabel)}</h4>
        <p${ed(o, 'contact.location')}>${esc(c.contact.location)}</p>
      </div>
      <div class="contact-col reveal">
        <h4${ed(o, 'contact.socialLabel')}>${esc(c.contact.socialLabel)}</h4>
        <div class="social-row">
${social}
        </div>
      </div>
    </div>
  </section>

  <script type="application/ld+json">${ldJson}</script>`;

  return pageShell(c, o, {
    root, home: true,
    title: c.meta.title, description: c.meta.description,
    pathname: '', ogImage: c.meta.ogImage, body
  });
}

/* ------------------------------ Project pages ----------------------------- */

export function renderProject(c, slug, o = {}) {
  const i = c.projects.findIndex((p) => p.slug === slug);
  if (i < 0) throw new Error(`Unknown project: ${slug}`);
  const p = c.projects[i];
  const root = o.preview ? '' : '../';
  const P = `projects.${i}`;

  const blocks = p.blocks
    .map((b, j) => {
      const B = `${P}.blocks.${j}`;
      if (b.type === 'text') {
        return `      <p class="reveal"${ed(o, `${B}.text`)}>${esc(b.text)}</p>`;
      }
      const n = b.images.length;
      const cls = n === 2 || n >= 4 ? ' cols-2' : n === 3 ? ' cols-3' : '';
      const imgs = b.images
        .map((im, k) => '        ' + img(o, root, { src: im.src, alt: im.alt, path: `${B}.images.${k}.src` }))
        .join('\n');
      return `      <div class="project-gallery${cls} reveal">\n${imgs}\n      </div>`;
    })
    .join('\n\n');

  const many = c.projects.length > 1;
  const prev = c.projects[(i - 1 + c.projects.length) % c.projects.length];
  const next = c.projects[(i + 1) % c.projects.length];
  const nav = many
    ? `
  <nav class="project-nav" aria-label="More projects">
    <div class="wrap project-nav-row">
      <a href="${esc(prev.slug)}.html">&larr; ${esc(flat(prev.name))}</a>
      <a href="${esc(next.slug)}.html">${esc(flat(next.name))} &rarr;</a>
    </div>
  </nav>`
    : '';

  const body = `  <section class="project-hero">
    <div class="wrap">
      <span class="work-year"${ed(o, `${P}.yearRange`)}>${esc(p.yearRange || p.year)}</span>
      <h1 class="project-title"${ed(o, `${P}.name`, true)}>${ml(p.name)}</h1>
      <div class="project-meta-row">
        <div>
          <h4>Services</h4>
          <p${ed(o, `${P}.services`)}>${esc(p.services)}</p>
        </div>
        <div>
          <h4>Brief</h4>
          <p${ed(o, `${P}.brief`)}>${esc(p.brief)}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="project-body">
    <div class="wrap">
${blocks}
    </div>
  </section>
${nav}`;

  return pageShell(c, o, {
    root, home: false,
    title: `${flat(p.name)} — ${c.hero.name}`,
    description: p.brief,
    pathname: `work/${p.slug}.html`,
    ogImage: p.cover || c.meta.ogImage,
    body
  });
}

/* ------------------------------ Whole site -------------------------------- */

// Every file that makes up the site: [{ path, html }]
export function renderSite(c, o = {}) {
  return [
    { path: 'index.html', html: renderHome(c, o) },
    ...c.projects.map((p) => ({ path: `work/${p.slug}.html`, html: renderProject(c, p.slug, o) }))
  ];
}

/* --------------------- Editor-preview-only CSS and script ------------------ */
// Injected only when o.preview is true (never into published files).

const PREVIEW_CSS = `
.reveal{opacity:1!important;transform:none!important}
[data-edit]{cursor:text;outline:1px dashed transparent;outline-offset:4px;transition:outline-color .15s}
[data-edit]:hover{outline-color:rgba(240,78,35,.75)}
[data-edit]:focus{outline:1px solid #f04e23}
[data-ml]{white-space:pre-line}
[data-edit-img]{cursor:pointer;outline:2px solid transparent;outline-offset:-2px;transition:outline-color .15s}
[data-edit-img]:hover{outline-color:#f04e23}
.frame-title{pointer-events:none}.frame-title-text{pointer-events:auto}
.img-empty{display:flex;align-items:center;justify-content:center;width:100%;min-height:220px;background:rgba(240,78,35,.06);border:1px dashed #f04e23;color:#f04e23;font:600 15px Inter,sans-serif;cursor:pointer}
.work-row-visual .img-empty{position:absolute;inset:0;min-height:0}
`;

const PREVIEW_SCRIPT = `
(function () {
  var post = function (m) { m.source = 'redactor'; parent.postMessage(m, '*'); };
  function read(el) {
    var out = '';
    (function walk(n) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeName === 'BR') out += '\\n';
        else { if (out && !/\\n$/.test(out) && /^(DIV|P)$/.test(c.nodeName)) out += '\\n'; walk(c); }
      });
    })(el);
    return out.replace(/\\u00a0/g, ' ').replace(/\\n+$/, '');
  }
  function startEdit(el) {
    if (el.isContentEditable) return;
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.focus();
  }
  // Links and images are not draggable inside the editor, so text can be selected by dragging.
  document.querySelectorAll('a, img').forEach(function (n) { n.setAttribute('draggable', 'false'); });
  // Start editing on mouse-down (not after the click) so double- and triple-click select text normally.
  document.addEventListener('mousedown', function (e) {
    var t = e.target.closest && e.target.closest('[data-edit]');
    if (t && e.button === 0) startEdit(t);
  }, true);
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    var im = e.target.closest('[data-edit-img]');
    var t = e.target.closest('[data-edit]');
    if (a || im) e.preventDefault();
    if (im) {
      e.stopPropagation();
      // The file chooser must open inside this click (browser security rule), so it lives here.
      var path = im.getAttribute('data-edit-img');
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = function () { if (inp.files && inp.files[0]) post({ type: 'image-picked', path: path, file: inp.files[0] }); };
      inp.click();
      return;
    }
    if (t) { startEdit(t); return; }
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') {
      var target = href === '#top' ? document.body : document.querySelector(href);
      if (target) target.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    var m = href.match(/work\\/([^/]+)\\.html$/) || href.match(/^([^/#]+)\\.html$/);
    if (m && m[1] !== 'index') { post({ type: 'nav', slug: m[1] }); return; }
    if (/index\\.html/.test(href) || href === '') { post({ type: 'nav', slug: 'home', hash: (href.split('#')[1] || '') }); return; }
  }, true);
  document.addEventListener('input', function (e) {
    var t = e.target.closest && e.target.closest('[data-edit]');
    if (t) post({ type: 'edit', path: t.getAttribute('data-edit'), value: read(t) });
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target.closest && e.target.closest('[data-edit]');
    if (!t) return;
    if (e.key === 'Escape') { t.blur(); return; }
    if (e.key === 'Enter' && !t.hasAttribute('data-ml')) { e.preventDefault(); t.blur(); }
  });
  document.addEventListener('paste', function (e) {
    var t = e.target.closest && e.target.closest('[data-edit]');
    if (!t) return;
    e.preventDefault();
    var txt = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, t.hasAttribute('data-ml') ? txt : txt.replace(/\\s*\\n\\s*/g, ' '));
  });
  document.addEventListener('focusout', function (e) {
    var t = e.target.closest && e.target.closest('[data-edit]');
    if (!t) return;
    t.removeAttribute('contenteditable');
    post({ type: 'commit' });
  });
  post({ type: 'ready' });
})();
`;
