/* ---------------------------------------------------------------------------
   warp.js — mouse-reactive headline distortion (plain WebGL, no libraries).

   How it works
   • Every element marked data-warp keeps its real text in the page (for
     search engines, screen readers and selection) but is painted by this
     script instead: the text is drawn into a 2D canvas, uploaded as a WebGL
     texture, and drawn onto ONE fixed full-screen canvas at the element's
     position every frame.
   • A fragment shader bends the texture around the pointer: a lens bulge, a
     liquid smear that follows the mouse's motion, faint ripples, and an RGB
     split. Scrolling adds a shear. Text also slides up as it scrolls in.
   • Anything that can go wrong (no WebGL, reduced-motion preference, editor
     preview, script error) simply leaves the normal text visible.
   Add ?nowarp to a page address to switch the effect off.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';

  var root = document.documentElement;
  if (root.hasAttribute('data-editor')) return;
  if (/[?&]nowarp\b/.test(location.search)) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function start() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-warp]'));
    if (!nodes.length) return;

    var canvas = document.createElement('canvas');
    canvas.className = 'warp-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) return;

    /* ------------------------------- shaders ------------------------------ */
    var VERT =
      'attribute vec2 aPos;' +
      'uniform vec4 uRect;' +      // x, y, w, h of the quad in CSS pixels (viewport space, y down)
      'uniform vec2 uView;' +      // viewport size in CSS pixels
      'varying vec2 vUv;' +
      'void main(){' +
      '  vUv = aPos;' +
      '  vec2 px = uRect.xy + aPos * uRect.zw;' +
      '  vec2 clip = px / uView * 2.0 - 1.0;' +
      '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);' +
      '}';

    var FRAG =
      'precision highp float;' +
      'uniform sampler2D uTex;' +
      'uniform vec2 uMouse;' +     // pointer position in the quad's 0..1 space
      'uniform vec2 uSize;' +      // quad size in CSS pixels
      'uniform vec2 uVel;' +       // smoothed pointer velocity (aspect-corrected)
      'uniform float uHover;' +    // 0..1 how close the pointer is
      'uniform float uTime;' +
      'uniform float uReveal;' +   // 0..1 entrance progress
      'uniform float uScroll;' +   // smoothed scroll velocity
      'varying vec2 vUv;' +
      'void main(){' +
      '  vec2 asp = vec2(uSize.x / uSize.y, 1.0);' +
      '  vec2 uv = vUv;' +
      // entrance: text rises into place
      '  uv.y += (1.0 - uReveal) * (1.0 - uReveal) * 0.45;' +
      '  vec2 d = (uv - uMouse) * asp;' +
      '  float dist = length(d);' +
      '  vec2 dir = d / max(dist, 0.0001);' +
      '  float fall = exp(-dist * dist * 6.0) * uHover;' +
      // magnifying lens: sample closer to the pointer (smooth, no singularity)
      '  vec2 off = -d * fall * 0.34;' +
      // liquid drag in the direction the pointer is travelling
      '  off -= uVel * fall * 0.5;' +
      // soft ripples travelling outwards
      '  off += dir * sin(dist * 30.0 - uTime * 3.5) * fall * 0.0045 * smoothstep(0.0, 0.12, dist);' +
      // scroll shear
      '  off.x -= uScroll * (uv.y - 0.5) * 0.035 * asp.x;' +
      '  vec2 o = off / asp;' +
      // a thin colour fringe along the displacement
      '  vec2 co = o * 0.05;' +
      '  vec4 r = texture2D(uTex, uv + o + co);' +
      '  vec4 g = texture2D(uTex, uv + o);' +
      '  vec4 b = texture2D(uTex, uv + o - co);' +
      '  vec4 c = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));' +
      '  gl_FragColor = c * uReveal;' +
      '}';

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }

    var prog, U = {};
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      if (window.console) console.warn('warp.js: shader failed, using plain text.', e);
      return;
    }
    gl.useProgram(prog);
    ['uRect', 'uView', 'uTex', 'uMouse', 'uSize', 'uVel', 'uHover', 'uTime', 'uReveal', 'uScroll'].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.uniform1i(U.uTex, 0);

    document.body.appendChild(canvas);
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

    /* -------------------------------- state ------------------------------- */
    var dpr = 1, vw = 0, vh = 0;
    var mouse = { x: -9999, y: -9999, inside: false };
    var lastY = window.scrollY, scrollV = 0;
    var raf = 0, lastT = 0;

    var items = nodes.map(function (el) {
      return {
        el: el, tex: null, c2d: null, built: false, pad: 0, w: 0, h: 0,
        hover: 0, mx: 0.5, my: 0.5, vx: 0, vy: 0, reveal: 0, revealTarget: 0
      };
    });

    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    function sizeCanvas() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      vw = window.innerWidth;
      vh = window.innerHeight;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uView, vw, vh);
    }

    /* ----------------------- text → texture (per element) ------------------ */
    function build(it) {
      var el = it.el;
      el.classList.remove('is-warped');                 // so we read the real colour
      var cs = getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) { it.built = false; return; }

      var fs = parseFloat(cs.fontSize) || 16;
      var pad = Math.ceil(fs * 0.4);
      var w = Math.ceil(rect.width) + pad * 2;
      var h = Math.ceil(rect.height) + pad * 2;

      var scale = Math.min(dpr, maxTex / w, maxTex / h);
      var px = w * h * scale * scale;
      if (px > 9e6) scale *= Math.sqrt(9e6 / px);       // keep memory sane on huge headlines

      var c = it.c2d || (it.c2d = document.createElement('canvas'));
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      var ctx = c.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      ctx.fillStyle = cs.color;
      ctx.textBaseline = 'alphabetic';
      if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      var tt = cs.textTransform;

      // Draw word by word at the exact position the browser laid it out.
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var range = document.createRange();
      var n;
      while ((n = walker.nextNode())) {
        var txt = n.nodeValue, re = /\S+/g, m;
        while ((m = re.exec(txt))) {
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          var r = range.getClientRects()[0];
          if (!r) continue;
          var word = m[0];
          if (tt === 'uppercase') word = word.toUpperCase();
          else if (tt === 'lowercase') word = word.toLowerCase();
          var asc = ctx.measureText(word).fontBoundingBoxAscent;
          if (!(asc > 0)) asc = fs * 0.8;
          ctx.fillText(word, r.left - rect.left + pad, r.top - rect.top + pad + asc);
        }
      }

      if (!it.tex) it.tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, it.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      it.pad = pad; it.w = w; it.h = h;
      it.cw = rect.width; it.ch = rect.height;
      it.built = true;
      el.classList.add('is-warped');                    // hide the DOM text; the canvas paints it now
    }

    /* --------------------------------- frame -------------------------------- */
    function wake() { if (!raf) raf = requestAnimationFrame(frame); }

    function frame(t) {
      raf = 0;
      var time = t / 1000;
      // Everything eases by elapsed time, so it feels the same at 30, 60 or 120 fps.
      var dt = lastT ? Math.min(Math.max((t - lastT) / 16.667, 0.25), 6) : 1;
      lastT = t;
      function ease(k) { return 1 - Math.pow(1 - k, dt); }
      var sy = window.scrollY;
      scrollV = scrollV * Math.pow(0.88, dt) + ((sy - lastY) / dt) * 0.12;
      lastY = sy;
      var animating = Math.abs(scrollV) > 0.12;
      if (!animating) scrollV = 0;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(U.uTime, time);
      gl.uniform1f(U.uScroll, clamp(scrollV, -60, 60) * 0.08);

      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.built) continue;

        // entrance (finishes even if the headline has scrolled out of view)
        if (it.reveal !== it.revealTarget) {
          it.reveal += (it.revealTarget - it.reveal) * ease(0.075);
          if (Math.abs(it.revealTarget - it.reveal) < 0.003) it.reveal = it.revealTarget; else animating = true;
        }

        var r = it.el.getBoundingClientRect();
        var x = r.left - it.pad, y = r.top - it.pad;
        if (y > vh + 40 || y + it.h < -40 || x > vw + 40 || x + it.w < -40) continue;

        // pointer proximity (fades the effect out as the pointer leaves)
        var dx = Math.max(x + it.pad - mouse.x, 0, mouse.x - (x + it.pad + it.cw));
        var dy = Math.max(y + it.pad - mouse.y, 0, mouse.y - (y + it.pad + it.ch));
        var reach = Math.max(it.ch * 0.5, 110);
        var target = mouse.inside ? clamp(1 - Math.hypot(dx, dy) / reach, 0, 1) : 0;
        it.hover += (target - it.hover) * ease(0.1);
        if (it.hover < 0.004 && target === 0) it.hover = 0;

        var u = (mouse.x - x) / it.w, v = (mouse.y - y) / it.h;
        var pmx = it.mx, pmy = it.my;
        if (it.hover < 0.02) { it.mx = u; it.my = v; }          // snap while idle
        else { it.mx += (u - it.mx) * ease(0.2); it.my += (v - it.my) * ease(0.2); }
        var asp = it.w / it.h;
        it.vx = clamp(it.vx * Math.pow(0.9, dt) + ((it.mx - pmx) / dt) * asp * 0.55, -0.16, 0.16);
        it.vy = clamp(it.vy * Math.pow(0.9, dt) + ((it.my - pmy) / dt) * 0.55, -0.16, 0.16);
        if (it.hover === 0 && Math.abs(it.vx) < 0.0004 && Math.abs(it.vy) < 0.0004) { it.vx = 0; it.vy = 0; }
        else animating = true;

        gl.bindTexture(gl.TEXTURE_2D, it.tex);
        gl.uniform4f(U.uRect, x, y, it.w, it.h);
        gl.uniform2f(U.uSize, it.w, it.h);
        gl.uniform2f(U.uMouse, it.mx, it.my);
        gl.uniform2f(U.uVel, it.vx, it.vy);
        gl.uniform1f(U.uHover, it.hover);
        gl.uniform1f(U.uReveal, it.reveal);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      if (animating) wake();
    }

    /* --------------------------------- events -------------------------------- */
    window.addEventListener('pointermove', function (e) {
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; wake();
    }, { passive: true });
    document.addEventListener('pointerleave', function () { mouse.inside = false; wake(); });
    window.addEventListener('blur', function () { mouse.inside = false; wake(); });
    window.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'touch') setTimeout(function () { mouse.inside = false; wake(); }, 400);
    });
    window.addEventListener('scroll', wake, { passive: true });

    // The text colour changes with the theme. Colours inherit through elements that are still fading,
    // so wait for the page's colour transition to finish, then redraw every headline in the new colour.
    var themeTimer;
    document.addEventListener('themechange', function () {
      canvas.style.transition = 'opacity .18s linear';
      canvas.style.opacity = '0';
      clearTimeout(themeTimer);
      themeTimer = setTimeout(function () {
        items.forEach(function (it) { if (it.built) build(it); });
        frame(performance.now());
        canvas.style.opacity = '1';
      }, 720);
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        sizeCanvas();
        items.forEach(function (it) { if (it.built) build(it); });
        frame(performance.now());
      }, 120);
    });

    /* ------------------- lazy building + entrance triggers ------------------ */
    function ensure(it) {
      if (it.built) return;
      build(it);
      if (it.built) frame(performance.now());           // paint in the same frame the DOM text hides
    }

    if ('IntersectionObserver' in window) {
      var near = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var it = items[nodes.indexOf(en.target)];
          ensure(it);
        });
      }, { rootMargin: '120% 0px 120% 0px' });

      var seen = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var it = items[nodes.indexOf(en.target)];
          ensure(it);
          setTimeout(function () { it.revealTarget = 1; wake(); }, it.delay || 0);
          seen.unobserve(en.target);
        });
      }, { threshold: 0.05, rootMargin: '0px 0px -4% 0px' });

      nodes.forEach(function (el, i) { items[i].delay = (i % 3) * 70; near.observe(el); seen.observe(el); });
    } else {
      items.forEach(function (it) { ensure(it); it.reveal = it.revealTarget = 1; });
    }

    // Rebuild a headline's texture if its box changes size (fonts loading, wrapping, edits).
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function (entries) {
        entries.forEach(function (en) {
          var it = items[nodes.indexOf(en.target)];
          if (!it || !it.built) return;
          var r = en.target.getBoundingClientRect();
          if (Math.abs(r.width - it.cw) > 1 || Math.abs(r.height - it.ch) > 1) { build(it); wake(); }
        });
      });
      nodes.forEach(function (el) { ro.observe(el); });
    }

    window.__warpItems = items;                          // handy for debugging in the console
    sizeCanvas();
    root.classList.add('warp-on');
    canvas.setAttribute('data-ready', '1');
    wake();
  }

  function go() {
    try { start(); } catch (e) { if (window.console) console.warn('warp.js disabled:', e); }
  }

  // Fonts must be loaded before text is measured and drawn.
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('1em "Instrument Serif"'),
      document.fonts.load('italic 1em "Instrument Serif"'),
      document.fonts.load('1em "DM Sans"')
    ]).catch(function () {}).then(function () { return document.fonts.ready; }).then(go);
  } else if (document.readyState === 'complete') go();
  else window.addEventListener('load', go);
})();
