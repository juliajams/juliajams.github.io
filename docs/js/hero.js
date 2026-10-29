/* ---------------------------------------------------------------------------
   hero.js — the interactive layer behind the hero text.

   Two modes, chosen in the editor (Hero → Hero visual):

   • scene  A soft gradient blob with film grain that floats across the whole
            hero and follows the cursor: it grows while the cursor moves and
            shrinks when it stops. No image files needed.
   • photo  Your photo, shown with a liquid lens under the cursor. If the
            photo is black & white, colour is revealed around the pointer.

   Anything that can go wrong (no WebGL, reduced motion, editor preview,
   script error) leaves the plain fallback in the page. ?nowarp turns it off.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';

  var root = document.documentElement;
  if (root.hasAttribute('data-editor')) return;
  if (/[?&]nowarp\b/.test(location.search)) return;

  var host = document.querySelector('.hero-visual[data-visual]');
  if (!host) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mode = host.getAttribute('data-visual');

  /* ------------------------------ shared plumbing ---------------------------- */

  var VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = vec2(aPos.x, 1.0 - aPos.y); gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }';
  var PRECISION = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

  function setup(fragSrc, uniformNames) {
    var canvas = document.createElement('canvas');
    canvas.className = 'hero-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) return null;

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, PRECISION + fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    uniformNames.forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    host.insertBefore(canvas, host.firstChild);
    return { canvas: canvas, gl: gl, U: U };
  }

  // Runs draw(timeSeconds, dt) every frame while the visual is on screen and the tab is visible.
  // draw returns false when it has nothing more to animate (it is woken again by wake()).
  function loop(draw) {
    var visible = true, raf = 0, last = 0;
    function tick(t) {
      raf = 0;
      if (!visible || document.hidden) { last = 0; return; }
      var dt = last ? Math.min(Math.max((t - last) / 16.667, 0.25), 6) : 1;
      last = t;
      if (draw(t / 1000, dt) !== false) raf = requestAnimationFrame(tick);
    }
    function wake() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) wake(); }).observe(host);
    }
    document.addEventListener('visibilitychange', wake);
    wake();
    return wake;
  }

  function isDark() { return root.getAttribute('data-theme') !== 'light'; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* -------------------------------- gradient blob ---------------------------------- */
  // One soft, irregular shape with a magenta -> coral -> amber gradient and film grain.
  // It floats across the whole hero, follows the cursor, stretches along its direction of travel,
  // grows while the cursor moves and shrinks again when it stops.

  var SCENE = [
    'uniform vec2 uRes; uniform vec2 uP; uniform vec2 uV; uniform float uR; uniform float uSpeed; uniform float uTime;',
    'varying vec2 vUv;',
    'float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'void main(){',
    '  float asp = uRes.x / uRes.y;',
    '  vec2 p = vec2(vUv.x * asp, vUv.y) - uP;',
    // squash and stretch along the direction of travel (area stays roughly constant)
    '  float sp = length(uV);',
    '  vec2 dir = sp > 0.0001 ? uV / sp : vec2(1.0, 0.0);',
    '  float st = 1.0 + min(sp * 9.0, 0.6);',
    '  vec2 q = vec2(dot(p, dir) / st, dot(p, vec2(-dir.y, dir.x)) * sqrt(st));',
    // an irregular, pebble-like outline: never a circle, livelier when moving
    '  float th = atan(p.y, p.x);',
    '  float live = 1.0 + min(uSpeed * 9.0, 0.9);',
    '  float w = (0.15 * sin(2.0 * th + uTime * 0.5 + 1.2) + 0.08 * sin(3.0 * th - uTime * 0.7) + 0.03 * sin(5.0 * th + uTime * 1.0 + 2.0)) * live;',
    '  float d = length(q) - uR * (1.0 + w);',
    // film grain, re-rolled about 24 times a second
    '  float f = floor(uTime * 24.0);',
    '  float g = hash(gl_FragCoord.xy + f * vec2(17.0, 31.0));',
    '  float g2 = hash(gl_FragCoord.yx * 1.31 + f * vec2(53.0, 7.0));',
    // soft edge that dissolves into grain
    '  float edge = 0.016 + min(uSpeed * 0.5, 0.03);',
    '  float alpha = 1.0 - smoothstep(-edge, edge, d + (g - 0.5) * 0.032);',
    // gradient across the shape, slowly turning: magenta-pink -> coral -> amber
    '  float ang = 0.78 + sin(uTime * 0.25) * 0.5;',
    '  float t = dot(q / uR, vec2(cos(ang), sin(ang)));',
    '  float k = clamp(t * 0.5 + 0.5, 0.0, 1.0);',
    '  vec3 c0 = vec3(0.86, 0.22, 0.52), c1 = vec3(0.95, 0.37, 0.40), c2 = vec3(1.00, 0.66, 0.18);',
    '  vec3 col = k < 0.5 ? mix(c0, c1, smoothstep(0.0, 0.5, k)) : mix(c1, c2, smoothstep(0.5, 1.0, k));',
    '  col += 0.10 * smoothstep(0.9, 0.0, length(q / uR - vec2(-0.35, -0.40)));',      // soft highlight, top left
    '  col += (g2 - 0.5) * 0.10 * (1.0 + 1.4 * smoothstep(-0.12, 0.02, d));',          // grain, stronger at the rim
    // a little grainy dust just outside the shape
    '  float dust = step(1.0 - 0.11 * smoothstep(0.13, 0.0, d), g) * 0.5;',
    '  float a = max(alpha, dust);',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * a, a);',
    '}'
  ].join('\n');

  function scene() {
    var g = setup(SCENE, ['uRes', 'uP', 'uV', 'uR', 'uSpeed', 'uTime']);
    if (!g) return;
    var gl = g.gl, canvas = g.canvas, U = g.U;

    // Positions are measured in "hero heights": y runs 0..1 down the hero, x runs 0..aspect across it.
    var aspect = 1.6;
    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      aspect = w / h;
      var s = Math.min(1, Math.sqrt(2200000 / (w * h)));        // one canvas pixel per CSS pixel keeps the grain crisp
      canvas.width = Math.max(2, Math.round(w * s));
      canvas.height = Math.max(2, Math.round(h * s));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
    }
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);

    var cx = aspect * 0.64, cy = 0.46;                           // cursor, in hero heights (starts where the blob rests)
    var lcx = cx, lcy = cy, inside = false;
    var P = { x: cx, y: cy }, V = { x: 0, y: 0 }, speed = 0;

    function paint(r, sp, time) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uP, P.x, P.y); gl.uniform2f(U.uV, V.x, V.y);
      gl.uniform1f(U.uR, r); gl.uniform1f(U.uSpeed, sp); gl.uniform1f(U.uTime, time);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function draw(time, dt) {
      // where it is heading: the cursor while the cursor is over the hero, otherwise a slow wander across the whole width
      var gx = inside ? cx : aspect * (0.5 + 0.30 * Math.sin(time * 0.23));
      var gy = inside ? cy : 0.5 + 0.26 * Math.sin(time * 0.31 + 1.0);

      // cursor speed: rises quickly, fades slowly
      var inst = inside ? Math.hypot(cx - lcx, cy - lcy) / dt : 0;
      lcx = cx; lcy = cy;
      speed += (inst - speed) * (inst > speed ? Math.min(1, 0.35 * dt) : Math.min(1, 0.035 * dt));

      // the blob drifts after the cursor; its own velocity drives the stretch
      var px = P.x, py = P.y;
      var k = Math.min(1, 0.085 * dt);
      P.x += (gx - P.x) * k; P.y += (gy - P.y) * k;
      V.x += ((P.x - px) / dt - V.x) * Math.min(1, 0.2 * dt);
      V.y += ((P.y - py) / dt - V.y) * Math.min(1, 0.2 * dt);

      var r = 0.095 + Math.min(speed * 4.6, 0.20) + 0.006 * Math.sin(time * 1.5);     // bigger when moving, smaller at rest
      paint(r, speed, time);
      return true;
    }

    host.classList.add('is-live');
    if (reduce) { paint(0.12, 0, 2.0); return; }               // reduced motion: one still frame

    var wake = loop(draw);
    window.addEventListener('pointermove', function (e) {
      var r = host.getBoundingClientRect();
      inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      cx = (e.clientX - r.left) / r.height;
      cy = (e.clientY - r.top) / r.height;
      wake();
    }, { passive: true });
    document.addEventListener('pointerleave', function () { inside = false; });
    window.addEventListener('blur', function () { inside = false; });
  }

  /* ---------------------------------- interactive photo ----------------------- */

  var PHOTO = [
    'uniform sampler2D uTex; uniform vec2 uRes; uniform vec2 uImg; uniform vec2 uMouse; uniform vec2 uVel;',
    'uniform float uHover; uniform float uTime; uniform float uGray;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 asp = vec2(uRes.x / uRes.y, 1.0);',
    '  vec2 uv = vUv;',
    '  vec2 d = (uv - uMouse) * asp;',
    '  float dist = length(d);',
    '  vec2 dir = d / max(dist, 0.0001);',
    '  float fall = exp(-dist * dist * 6.0) * uHover;',
    '  vec2 off = -d * fall * 0.30;',                                       // lens
    '  off -= uVel * fall * 0.5;',                                          // liquid drag
    '  off += dir * sin(dist * 28.0 - uTime * 3.0) * fall * 0.004 * smoothstep(0.0, 0.1, dist);',
    '  off += (uMouse - 0.5) * -0.03 * uHover;',                            // slight parallax
    '  vec2 suv = uv + off / asp;',
    // "cover" fit with a little zoom so the edges never show
    '  float ca = uRes.x / uRes.y, ia = uImg.x / uImg.y;',
    '  vec2 sc = ca > ia ? vec2(1.0, ia / ca) : vec2(ca / ia, 1.0);',
    '  vec2 tuv = (suv - 0.5) * sc * 0.95 + 0.5;',
    '  vec2 co = off / asp * 0.05;',
    '  vec3 col = vec3(texture2D(uTex, tuv + co).r, texture2D(uTex, tuv).g, texture2D(uTex, tuv - co).b);',
    '  float g = dot(col, vec3(0.299, 0.587, 0.114));',
    '  float amt = clamp((1.0 - uGray) + smoothstep(0.55, 0.0, dist) * uHover, 0.0, 1.0);',   // colour blooms under the cursor
    '  col = mix(vec3(g), col, amt);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function photo() {
    var img = host.querySelector('img');
    if (!img) return;
    var g = setup(PHOTO, ['uTex', 'uRes', 'uImg', 'uMouse', 'uVel', 'uHover', 'uTime', 'uGray']);
    if (!g) return;
    var gl = g.gl, canvas = g.canvas, U = g.U;
    var gray = host.hasAttribute('data-gray') ? 1 : 0;

    var tex = gl.createTexture();
    var ready = false, iw = 1, ih = 1;
    function upload() {
      if (!img.naturalWidth) { canvas.remove(); return; }                 // e.g. an SVG without a size: keep the plain <img>
      iw = img.naturalWidth; ih = img.naturalHeight;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(U.uTex, 0);
      gl.uniform2f(U.uImg, iw, ih);
      gl.uniform1f(U.uGray, gray);
      ready = true;
      host.classList.add('is-live');
      if (wake) wake();
    }
    if (img.complete) { if (img.naturalWidth) upload(); else canvas.remove(); }
    else { img.addEventListener('load', upload); img.addEventListener('error', function () { canvas.remove(); }); }

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, w, h);
      if (wake) wake();
    }
    var wake;
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);

    var mouse = { x: -1e4, y: -1e4, inside: false };
    var hover = 0, mx = 0.5, my = 0.5, vx = 0, vy = 0;

    wake = loop(function (time, dt) {
      if (!ready) return false;
      var r = host.getBoundingClientRect();
      var u = (mouse.x - r.left) / r.width, v = (mouse.y - r.top) / r.height;
      var target = mouse.inside && u > -0.1 && u < 1.1 && v > -0.1 && v < 1.1 ? 1 : 0;
      hover += (target - hover) * Math.min(1, 0.1 * dt);
      var pmx = mx, pmy = my;
      if (hover < 0.02) { mx = u; my = v; } else { mx += (u - mx) * Math.min(1, 0.2 * dt); my += (v - my) * Math.min(1, 0.2 * dt); }
      var asp = r.width / r.height;
      vx = clamp(vx * Math.pow(0.9, dt) + ((mx - pmx) / dt) * asp * 0.55, -0.16, 0.16);
      vy = clamp(vy * Math.pow(0.9, dt) + ((my - pmy) / dt) * 0.55, -0.16, 0.16);
      var still = target === 0 && hover < 0.004 && Math.abs(vx) < 0.0004 && Math.abs(vy) < 0.0004;
      if (still) { hover = 0; vx = vy = 0; }

      gl.uniform2f(U.uMouse, mx, my);
      gl.uniform2f(U.uVel, vx, vy);
      gl.uniform1f(U.uHover, hover);
      gl.uniform1f(U.uTime, time);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return !still;
    });
    resize();

    window.addEventListener('pointermove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; wake(); }, { passive: true });
    document.addEventListener('pointerleave', function () { mouse.inside = false; wake(); });
    window.addEventListener('scroll', function () { wake(); }, { passive: true });
  }

  /* ------------------------------------ launch ------------------------------- */

  try {
    if (mode === 'photo') { if (!reduce) photo(); } else scene();
  } catch (e) {
    if (window.console) console.warn('hero.js: showing the plain fallback.', e);
  }
})();
