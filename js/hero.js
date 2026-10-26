/* ---------------------------------------------------------------------------
   hero.js — the big interactive visual next to the intro.

   Two modes, chosen in the editor (Hero → Hero visual):

   • scene  A 3D sculpture drawn live by a shader (rings and an orange core,
            reflecting a warm studio). Drag to spin it; it also leans toward
            the pointer and keeps turning slowly. No image files needed.
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

  /* ----------------------------------- 3D scene ------------------------------- 

  var SCENE = [
    'uniform vec2 uRes; uniform float uTime; uniform vec2 uRot; uniform float uDark;',
    'varying vec2 vUv;',
    'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }',
    'float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }',
    'float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }',

    // The sculpture: three rings on different axes, blended softly, around a core.
    'float map(vec3 p, out float mat){',
    '  p.xz = rot(uRot.x) * p.xz;',
    '  p.yz = rot(uRot.y) * p.yz;',
    '  vec3 a = p; a.xy = rot(uTime * 0.30) * a.xy;',
    '  vec3 b = p; b.yz = rot(1.5708 + uTime * 0.22) * b.yz; b.xy = rot(0.5) * b.xy;',
    '  vec3 c = p; c.xz = rot(uTime * 0.17) * c.xz; c.xy = rot(1.5708) * c.xy;',
    '  float r1 = sdTorus(a, vec2(1.00, 0.060));',
    '  float r2 = sdTorus(b, vec2(0.82, 0.060));',
    '  float r3 = sdTorus(c, vec2(0.64, 0.060));',
    '  float rings = smin(smin(r1, r2, 0.05), r3, 0.05);',
    '  float core = length(p) - 0.30 - 0.015 * sin(uTime * 2.0);',
    '  mat = step(core, rings);',
    '  return min(rings, core);',
    '}',

    // A cheap studio: a gradient room with an orange softbox and a cream key light.
    'vec3 env(vec3 rd){',
    '  float y = rd.y * 0.5 + 0.5;',
    '  vec3 top = mix(vec3(0.97, 0.94, 0.89), vec3(0.20, 0.19, 0.18), uDark);',
    '  vec3 bot = mix(vec3(0.24, 0.22, 0.20), vec3(0.015), uDark);',
    '  vec3 c = mix(bot, top, smoothstep(0.0, 1.0, y));',
    '  c += vec3(1.0, 0.30, 0.12) * pow(max(dot(rd, normalize(vec3(-0.7, 0.25, 0.65))), 0.0), 18.0) * 2.2;',
    '  c += vec3(1.0, 0.92, 0.82) * pow(max(dot(rd, normalize(vec3(0.65, 0.65, 0.45))), 0.0), 42.0) * 1.8;',
    '  c += vec3(1.0, 0.92, 0.82) * pow(max(dot(rd, normalize(vec3(0.0, -0.8, 0.6))), 0.0), 10.0) * 0.35;',
    '  return c;',
    '}',
    'vec3 normalAt(vec3 p){ vec2 e = vec2(0.0012, 0.0); float m;',
    '  return normalize(vec3(map(p + e.xyy, m) - map(p - e.xyy, m), map(p + e.yxy, m) - map(p - e.yxy, m), map(p + e.yyx, m) - map(p - e.yyx, m))); }',
    'vec3 shade(vec3 pos, vec3 rd){',
    '  float m; map(pos, m);',
    '  vec3 n = normalAt(pos);',
    '  vec3 r = reflect(rd, n);',
    '  float fr = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);',
    '  vec3 tint = mix(vec3(0.96, 0.95, 0.93), vec3(1.0, 0.40, 0.26), m);',
    '  vec3 col = env(r) * tint * (0.85 + 0.15 * fr) + fr * 0.18 * env(n);',
    '  col += m * vec3(1.0, 0.26, 0.09) * 0.30;',                         // the core glows a little
    '  return col + tint * 0.04;',
    '}',
    'vec3 grade(vec3 c){ return pow(c / (1.0 + c * 0.18), vec3(0.4545)); }',

    'void main(){',
    '  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * vec2(1.0, -1.0);',
    '  vec3 ro = vec3(0.0, 0.0, 5.6);',
    '  vec3 rd = normalize(vec3(p, -2.1));',
    '  float b = dot(ro, rd);',
    '  float disc = b * b - (dot(ro, ro) - 1.45 * 1.45);',
    '  vec4 outc = vec4(0.0);',
    '  if (disc > 0.0) {',                       // only rays that touch the bounding sphere are marched
    '    float sq = sqrt(disc);',
    '    float t = -b - sq, tmax = -b + sq;',
    '    float md = 1e3, mt = t, m; bool hit = false;',
    '    for (int i = 0; i < 72; i++) {',
    '      float d = map(ro + rd * t, m);',
    '      if (d < md) { md = d; mt = t; }',
    '      if (d < 0.0015) { hit = true; break; }',
    '      t += d; if (t > tmax) break;',
    '    }',
    '    if (hit) outc = vec4(grade(shade(ro + rd * t, rd)), 1.0);',
    '    else { float a = 1.0 - smoothstep(0.0, 0.012, md);',             // soft silhouette edge
    '           if (a > 0.01) outc = vec4(grade(shade(ro + rd * mt, rd)) * a, a); }',
    '  }',
    '  gl_FragColor = outc;',
    '}'
  ].join('\n');

  function scene() {
    var g = setup(SCENE, ['uRes', 'uTime', 'uRot', 'uDark']);
    if (!g) return;
    var gl = g.gl, canvas = g.canvas, U = g.U;

    var scale = Math.min(window.devicePixelRatio || 1, 1.5);
    var maxScale = scale;
    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      var s = scale;
      while (w * h * s * s > 950000 && s > 0.4) s *= 0.92;         // keep the pixel count reasonable
      canvas.width = Math.max(2, Math.round(w * s));
      canvas.height = Math.max(2, Math.round(h * s));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
    }
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);

    // rotation state
    var rotY = 0.6, rotX = 0.35, velY = 0.004, velX = 0, tiltX = 0, tiltY = 0, px = 0, py = 0;
    var dragging = false, lastX = 0, lastY = 0, frames = 0, acc = 0, lastT = 0;

    function drawOnce(time, spin) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(U.uTime, time);
      gl.uniform2f(U.uRot, spin.y, spin.x);
      gl.uniform1f(U.uDark, isDark() ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    host.classList.add('is-live');

    if (reduce) {                                           // one still frame, no motion, no interaction
      drawOnce(2.0, { x: rotX, y: rotY });
      document.addEventListener('themechange', function () { drawOnce(2.0, { x: rotX, y: rotY }); });
      return;
    }

    var wake = loop(function (time, dt) {
      if (!dragging) {
        rotY += velY * dt;
        velY += (0.004 - velY) * 0.03 * dt;                  // glide back to the slow idle spin
        rotX += velX * dt;
        velX *= Math.pow(0.92, dt);
        rotX += (0.35 - rotX) * 0.008 * dt;
      }
      rotX = clamp(rotX, -1.15, 1.15);
      tiltY += (px * 0.55 - tiltY) * Math.min(1, 0.06 * dt);
      tiltX += (py * 0.35 - tiltX) * Math.min(1, 0.06 * dt);
      drawOnce(time, { x: rotX + tiltX, y: rotY + tiltY });

      // Quality follows speed: if frames are slow, render fewer pixels; if fast, win some back.
      if (lastT) { acc += (time - lastT) * 1000; frames++; }
      lastT = time;
      if (frames >= 40) {
        var avg = acc / frames; frames = 0; acc = 0;
        if (avg > 24 && scale > 0.5) { scale *= 0.85; resize(); }
        else if (avg < 14 && scale < maxScale) { scale = Math.min(maxScale, scale * 1.1); resize(); }
      }
      return true;
    });

    host.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('a')) return;      // let the round badge link work
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      host.classList.add('is-grabbing');
      if (host.setPointerCapture) { try { host.setPointerCapture(e.pointerId); } catch (x) {} }
    });
    function end() { dragging = false; host.classList.remove('is-grabbing'); }
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    window.addEventListener('pointermove', function (e) {
      var r = host.getBoundingClientRect();
      px = clamp((e.clientX - r.left) / r.width - 0.5, -0.9, 0.9);
      py = clamp((e.clientY - r.top) / r.height - 0.5, -0.9, 0.9);
      if (dragging) {
        var dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        rotY += dx * 0.008; rotX += dy * 0.008;
        velY = dx * 0.008; velX = dy * 0.008;
      }
      wake();
    }, { passive: true });
    document.addEventListener('themechange', wake);
  }

   ---------------------------------- interactive photo ----------------------- */

    /* ------------------------ gradient blob ------------------------ */

  var SCENE = [
    'uniform vec2 uRes; uniform vec2 uA; uniform vec2 uB; uniform vec2 uC;',
    'uniform float uR; uniform float uWob; uniform float uTime; uniform float uDark;',
    'varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main(){',
    '  float asp = uRes.x / uRes.y;',
    '  vec2 p = vec2(vUv.x * asp, vUv.y);',
    // liquid edge: the shape wobbles more the faster the cursor moves
    '  p += uWob * 0.045 * vec2(sin(p.y * 7.0 + uTime * 1.9), sin(p.x * 7.0 - uTime * 1.6));',
    // three soft lobes that trail the cursor at different speeds and melt together
    '  vec2 a = p - uA, b = p - uB, c = p - uC;',
    '  float fa = (uR * uR) / (dot(a, a) + 0.0008);',
    '  float fb = (uR * uR * 0.80) / (dot(b, b) + 0.0008);',
    '  float fc = (uR * uR * 0.65) / (dot(c, c) + 0.0008);',
    '  float f = fa + fb + fc;',
    '  vec3 cA = vec3(1.00, 0.32, 0.15);',                                          // the site red
    '  vec3 cB = vec3(1.00, 0.62, 0.38);',                                          // apricot
    '  vec3 cC = mix(vec3(1.00, 0.45, 0.58), vec3(0.98, 0.83, 0.72), uDark);',      // rose (light) / cream (dark)
    '  vec3 col = (cA * fa + cB * fb + cC * fc) / max(f, 0.0001);',
    '  col += vec3(0.20, 0.10, 0.05) * smoothstep(1.2, 4.0, f);',                   // brighter heart
    '  float alpha = smoothstep(0.35, 2.2, f);',                                    // wide ramp = blurred edge
    '  float n = (hash(gl_FragCoord.xy) - 0.5) / 255.0;',                           // dither, avoids banding
    '  alpha = clamp(alpha + n * 2.0, 0.0, 1.0);',
    '  gl_FragColor = vec4(clamp(col + n, 0.0, 1.0) * alpha, alpha);',
    '}'
  ].join('\n');

  function scene() {
    var g = setup(SCENE, ['uRes', 'uA', 'uB', 'uC', 'uR', 'uWob', 'uTime', 'uDark']);
    if (!g) return;
    var gl = g.gl, canvas = g.canvas, U = g.U;

    // Positions are measured in "hero heights": y runs 0..1, x runs 0..aspect.
    var aspect = 1.2;
    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      aspect = w / h;
      canvas.width = Math.max(2, Math.round(w * 0.5));   // it is blurry anyway, so half resolution is plenty
      canvas.height = Math.max(2, Math.round(h * 0.5));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
    }
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);

    var px = aspect / 2, py = 0.5, lpx = px, lpy = py, inside = false;
    var A = { x: px, y: py }, B = { x: px, y: py }, C = { x: px, y: py };
    var speed = 0;                                       // smoothed cursor speed, in hero-heights per frame

    function follow(L, tx, ty, k, dt) { var s = Math.min(1, k * dt); L.x += (tx - L.x) * s; L.y += (ty - L.y) * s; }

    function draw(time, dt) {
      // heading: the cursor while it is over the hero, otherwise a slow drift around the middle
      var gx = inside ? px : aspect * 0.5 + Math.sin(time * 0.45) * aspect * 0.12;
      var gy = inside ? py : 0.5 + Math.cos(time * 0.37) * 0.10;

      // speed rises quickly when the cursor moves and fades slowly when it stops
      var inst = inside ? Math.hypot(px - lpx, py - lpy) / dt : 0;
      lpx = px; lpy = py;
      speed += (inst - speed) * (inst > speed ? Math.min(1, 0.35 * dt) : Math.min(1, 0.035 * dt));

      follow(A, gx, gy, 0.14, dt);
      follow(B, gx + Math.cos(time * 0.8) * 0.04, gy + Math.sin(time * 0.8) * 0.04, 0.075, dt);
      follow(C, gx + Math.cos(time * 0.6 + 2.1) * 0.05, gy + Math.sin(time * 0.6 + 2.1) * 0.05, 0.045, dt);

      var r = 0.105 + Math.min(speed * 4.2, 0.20) + 0.008 * Math.sin(time * 1.7);   // bigger when moving, smaller at rest
      var wob = 0.25 + Math.min(speed * 14, 1.2);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uA, A.x, A.y); gl.uniform2f(U.uB, B.x, B.y); gl.uniform2f(U.uC, C.x, C.y);
      gl.uniform1f(U.uR, r); gl.uniform1f(U.uWob, wob);
      gl.uniform1f(U.uTime, time); gl.uniform1f(U.uDark, isDark() ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    }

    host.classList.add('is-live');
    if (reduce) {                                        // reduced motion: one still frame
      draw(2, 1);
      document.addEventListener('themechange', function () { draw(2, 1); });
      return;
    }
    var wake = loop(draw);
    host.addEventListener('pointermove', function (e) {
      var r = host.getBoundingClientRect();
      px = (e.clientX - r.left) / r.height;
      py = (e.clientY - r.top) / r.height;
      inside = true;
      wake();
    }, { passive: true });
    host.addEventListener('pointerleave', function () { inside = false; });
  }

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
