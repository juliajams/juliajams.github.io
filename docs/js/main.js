// Yuliia Shtefan — site interactions. No dependencies.
// Everything here is an enhancement: with JavaScript off, the page still reads and works.

(function () {
  'use strict';

  var root = document.documentElement;
  var editor = root.hasAttribute('data-editor');            // set only inside the visual editor's preview
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;

  var scrubs = [];                                          // paragraphs whose words light up on scroll

  function ready(fn) {
    if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    headerScroll();
    navToggle();
    themeToggle();
    revealOnScroll();
    year();
    if (editor) return;                                      // keep text plain so it can be edited in place
    rollLinks();
    if (!reduce) { magnetic(); }
    scrubText();
    motionLoop();
    if (fine && !reduce) peek();
  });

  /* ---------------------------------- basics ---------------------------------- */

  function headerScroll() {
    var header = document.querySelector('.site-header');
    if (!header) return;
    function on() { header.classList.toggle('is-scrolled', window.scrollY > 8); }
    on();
    window.addEventListener('scroll', on, { passive: true });
  }

  function navToggle() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.main-nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      root.classList.toggle('menu-open', open);
    });
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        root.classList.remove('menu-open');
      });
    });
  }

  // Fades ordinary content in (headlines are handled by warp.js).
  function revealOnScroll() {
    var targets = document.querySelectorAll('.reveal');
    if (!targets.length) return;
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------- light / dark theme switch ------------------------ */

  // The page already has data-theme (set in <head> before first paint). This wires up the button,
  // remembers the choice, and tells warp.js / hero.js so they can repaint in the new colours.
  function themeToggle() {
    var btn = document.querySelector('[data-theme-toggle]');
    var meta = document.querySelector('meta[name="theme-color"]');
    var def = root.getAttribute('data-theme-default');
    var forced = root.hasAttribute('data-forced-theme');           // the editor can pin a theme for its preview
    function current() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
    function sync() {
      var t = current();
      if (meta) meta.setAttribute('content', t === 'light' ? '#f4f1ea' : '#0a0a0a');
      if (btn) {
        btn.setAttribute('aria-label', t === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
        btn.setAttribute('aria-pressed', String(t === 'light'));
      }
    }
    function apply(t, remember) {
      root.classList.add('theme-anim');
      root.setAttribute('data-theme', t);
      if (remember) { try { localStorage.setItem('theme', t); } catch (e) {} }
      sync();
      document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
      setTimeout(function () { root.classList.remove('theme-anim'); }, 650);
    }
    sync();
    if (btn) btn.addEventListener('click', function () { apply(current() === 'light' ? 'dark' : 'light', !forced); });

    // With no saved choice and the site set to "follow the device", follow it live.
    if (!forced && def === 'system' && window.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: light)');
      var onChange = function (e) {
        var saved; try { saved = localStorage.getItem('theme'); } catch (x) {}
        if (!saved) apply(e.matches ? 'light' : 'dark', false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    }
  }

  function year() {
    var el = document.querySelector('[data-year]');
    if (el) el.textContent = new Date().getFullYear();
  }

  /* ----------------------- letters that roll on hover ------------------------- */

  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function rollLinks() {
    document.querySelectorAll('[data-roll]').forEach(function (a) {
      var text = a.textContent.trim();
      if (!text) return;
      a.setAttribute('aria-label', text);
      var wrap = document.createElement('span');
      wrap.className = 'roll';
      wrap.setAttribute('aria-hidden', 'true');
      Array.from(text).forEach(function (ch, i) {
        var c = document.createElement('span');
        c.className = 'ch';
        c.style.setProperty('--i', i);
        var face = escapeHtml(ch === ' ' ? '\u00a0' : ch);
        c.innerHTML = '<span>' + face + '</span><span>' + face + '</span>';
        wrap.appendChild(c);
      });
      a.textContent = '';
      a.appendChild(wrap);
    });
  }

  /* ------------------------ elements that lean to the cursor ------------------ */

  function magnetic() {
    if (!fine) return;
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      var strength = parseFloat(el.getAttribute('data-magnetic')) || 0.3;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - (r.left + r.width / 2)) * strength;
        var y = (e.clientY - (r.top + r.height / 2)) * strength;
        el.style.transition = 'transform .15s ease-out';
        el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      });
      el.addEventListener('pointerleave', function () {
        el.style.transition = 'transform .7s cubic-bezier(.16,1,.3,1)';
        el.style.transform = '';
      });
    });
  }

  /* --------------- words that light up as you scroll past them ---------------- */

  function scrubText() {
    document.querySelectorAll('[data-scrub]').forEach(function (el) {
      var text = el.textContent.trim().split(/\s+/);
      el.setAttribute('aria-label', text.join(' '));
      el.textContent = '';
      var words = text.map(function (w, i) {
        var s = document.createElement('span');
        s.className = 'sw';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = w;
        el.appendChild(s);
        if (i < text.length - 1) el.appendChild(document.createTextNode(' '));
        return s;
      });
      scrubs.push({ el: el, words: words });
    });
  }
  function updateScrub() {
    var vh = window.innerHeight;
    scrubs.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      var p = (vh * 0.82 - r.top) / (r.height + vh * 0.28);
      p = Math.max(0, Math.min(1, p));
      var n = Math.round(p * s.words.length);
      for (var i = 0; i < s.words.length; i++) {
        var on = i < n;
        if (s.words[i]._on !== on) { s.words[i]._on = on; s.words[i].classList.toggle('on', on); }
      }
    });
  }

  /* --------- one animation loop: marquee, circular text, scroll-lit text -------- */

  function motionLoop() {
    var marquees = Array.prototype.map.call(document.querySelectorAll('[data-marquee]'), function (el) {
      return { el: el, x: 0, half: 0, visible: true };
    });
    var badges = Array.prototype.map.call(document.querySelectorAll('[data-kinetic]'), function (el) {
      return { el: el, rot: el.querySelector('.badge-rot'), a: 0, visible: true };
    });
    var all = marquees.concat(badges);

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          for (var i = 0; i < all.length; i++) if (all[i].el === en.target) all[i].visible = en.isIntersecting;
        });
      });
      all.forEach(function (m) { io.observe(m.el); });
    }

    function measure() {
      marquees.forEach(function (m) { m.half = m.el.scrollWidth / 2; });
    }
    measure();
    window.addEventListener('resize', measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

    var lastY = window.scrollY, v = 0;
    function loop() {
      var y = window.scrollY;
      v = v * 0.9 + (y - lastY) * 0.1;
      lastY = y;
      if (!reduce) {
        marquees.forEach(function (m) {
          if (!m.visible || !m.half) return;
          m.x -= 0.6 + Math.min(Math.abs(v) * 0.5, 14);
          if (m.x <= -m.half) m.x += m.half;
          m.el.style.transform = 'translate3d(' + m.x.toFixed(2) + 'px,0,0)';
        });
        badges.forEach(function (b) {
          if (!b.visible || !b.rot) return;
          b.a += 0.22 + v * 0.18;
          b.rot.style.transform = 'rotate(' + b.a.toFixed(2) + 'deg)';
        });
      }
      if (scrubs.length) updateScrub();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  /* ----------- project list: an image follows the cursor, leaning into motion --- */

  function peek() {
    var rows = document.querySelectorAll('.wk[data-cover]');
    if (!rows.length) return;
    var box = document.createElement('div');
    box.className = 'peek';
    box.setAttribute('aria-hidden', 'true');
    var im = document.createElement('img');
    im.alt = '';
    box.appendChild(im);
    document.body.appendChild(box);

    var x = 0, y = 0, tx = 0, ty = 0, vx = 0, shown = false, running = false, arrow = null;
    var FADE = 80;                       // px: the image starts fading this far from the arrow button

    function loop() {
      var px = x;
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      vx = vx * 0.85 + (x - px) * 0.15;
      var rot = Math.max(-14, Math.min(14, vx * 1.2));
      box.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translate(-50%,-50%) rotate(' + rot.toFixed(2) + 'deg)';

      // Fade out as the image gets close to, or covers, the row's arrow button.
      var alpha = 1;
      if (shown && arrow) {
        var b = box.getBoundingClientRect(), a = arrow.getBoundingClientRect();
        var gx = Math.max(b.left - a.right, a.left - b.right, 0);
        var gy = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
        alpha = Math.min(1, Math.hypot(gx, gy) / FADE);
      }
      box.style.opacity = shown ? alpha.toFixed(3) : '0';

      if (shown || Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5) requestAnimationFrame(loop); else running = false;
    }
    function run() { if (!running) { running = true; requestAnimationFrame(loop); } }

    rows.forEach(function (row) {
      row.addEventListener('pointerenter', function (e) {
        im.src = row.getAttribute('data-cover');
        arrow = row.querySelector('.wk-arrow');
        if (!shown) { x = tx = e.clientX; y = ty = e.clientY; }
        shown = true;
        box.classList.add('on');
        run();
      });
      row.addEventListener('pointermove', function (e) { tx = e.clientX; ty = e.clientY; run(); });
      row.addEventListener('pointerleave', function () { shown = false; box.classList.remove('on'); box.style.opacity = '0'; });
    });
  }
})();
