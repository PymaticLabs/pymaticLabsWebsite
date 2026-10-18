// Shaders del hilo (ver core-scene.tsx). Cada celda es una instancia: un cuadrado en pantalla que
// envuelve su nodo y los dos medios tramos hacia la celda anterior y la siguiente; el fragmento traza
// las lineas con su brillo, el punto del nodo y, segun el nivel, la carpeta, la tarjeta del documento
// (con el dibujo de su tipo y, la objetivo, sus renglones de pagina al acercarse) o el candado. Con
// DOME, la celda viene ya en el espacio (el cerebro entero, sobre la boveda); sin el, es una celda de
// un plano fino y se calcula aqui a partir de su posicion y sus enlaces.

const COMMON = /* glsl */ `
  uniform vec2 uRes;
  uniform float uDpr;
  varying vec2 vA;
  varying vec2 vM1;
  varying vec2 vM2;
  varying vec2 vRight;
  varying float vCell;
  varying float vFade;
  varying float vPulse;
  varying float vPh;
  varying float vRand;
  varying vec4 vMarks;
  varying float vFolder;
  varying float vCard;
  varying float vKind;

  float bit(float m, float b) { return mod(floor(m / b), 2.0); }
`

export const THREAD_VERTEX = /* glsl */ `
  ${COMMON}
  #ifdef DOME
  attribute vec3 aA;
  attribute vec3 aPrev;
  attribute vec3 aNext;
  attribute vec4 aInfo;
  uniform float uZone;
  uniform float uZoneFrom;
  uniform float uZoneMix;
  uniform float uZoneAmt;
  uniform float uTarget;
  #else
  attribute vec4 aCell;
  uniform vec2 uPatch;
  #endif
  uniform float uAlpha;
  uniform float uLens;
  uniform vec2 uLensAt;
  uniform float uLineW;
  uniform float uGlow;
  uniform float uDotR;
  uniform float uTime;
  uniform float uPulse;
  uniform float uSpeed;
  uniform float uHead;
  uniform float uTail;
  uniform float uGlowAmt;
  uniform float uCardOn;
  uniform float uMaxCell;

  vec2 toScreen(vec4 c) { return (c.xy / c.w * 0.5 + 0.5) * uRes; }
  vec3 stepTo(float k) {
    return k < 0.5 ? vec3(1.0, 0.0, 0.0) : k < 1.5 ? vec3(0.0, 1.0, 0.0) : k < 2.5 ? vec3(-1.0, 0.0, 0.0) : k < 3.5 ? vec3(0.0, -1.0, 0.0) : vec3(0.0);
  }
  void cull() { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); }

  void main() {
    #ifdef DOME
    vec3 A = aA;
    vec3 P = aPrev;
    vec3 B = aNext;
    float marks = aInfo.z;
    float phase = aInfo.y;
    // La zona a la que se va se enciende y las demas se apagan un poco. Con el simbolo entero quieto,
    // la luz pasa poco a poco de la zona que se deja a la siguiente.
    float inTo = 1.0 - step(0.5, abs(aInfo.x - uZone));
    float inFrom = 1.0 - step(0.5, abs(aInfo.x - uZoneFrom));
    float inZone = mix(inFrom, inTo, uZoneMix);
    float rim = bit(marks, 32.0);
    float fade = mix(1.0, mix(mix(0.3, 1.5, inZone), 0.8, rim), uZoneAmt);
    float target = (1.0 - step(0.5, abs(aInfo.w - uTarget))) * uZoneAmt * uZoneMix;
    vec3 gridI = vec3(1.0, 0.0, 0.0);
    vec3 gridJ = vec3(0.0, 1.0, 0.0);
    #else
    float code = aCell.z;
    vec3 A = vec3(aCell.xy, 0.0);
    vec3 P = A + stepTo(mod(code, 5.0));
    vec3 B = A + stepTo(mod(floor(code / 5.0), 5.0));
    float marks = floor(code / 25.0);
    float phase = aCell.w;
    float rim = 0.0;
    // El trozo se desvanece hacia su borde.
    vec2 e = abs(aCell.xy) / uPatch;
    float fade = 1.0 - smoothstep(0.72, 1.0, pow(pow(e.x, 4.0) + pow(e.y, 4.0), 0.25));
    float target = bit(marks, 16.0);
    vec3 gridI = A + vec3(1.0, 0.0, 0.0);
    vec3 gridJ = A + vec3(0.0, 1.0, 0.0);
    #endif
    vFade = uAlpha * fade;
    if (vFade < 0.003) { cull(); return; }
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 cA = mvp * vec4(A, 1.0);
    vec4 c1 = mvp * vec4(mix(A, P, 0.5), 1.0);
    vec4 c2 = mvp * vec4(mix(A, B, 0.5), 1.0);
    if (cA.w <= 0.0 || c1.w <= 0.0 || c2.w <= 0.0) { cull(); return; }
    vA = toScreen(cA);
    vM1 = toScreen(c1);
    vM2 = toScreen(c2);
    // Lente: los niveles finos se ven solo en un circulo alrededor del objetivo, que se abre al acercarse
    // (medido con el lado corto de la pantalla, para que en el movil tambien se vea el circulo).
    vFade *= 1.0 - smoothstep(uLens, uLens + 0.38, length(vA - uLensAt) / min(uRes.x, uRes.y));
    vCell = 2.0 * max(length(vM2 - vA), length(vM1 - vA));
    // Celdas enormes (un nivel que ya se va) no se pintan: serian lineas sueltas. La tarjeta objetivo si crece.
    if (vFade < 0.003 || vCell > uMaxCell) { cull(); return; }
    #ifdef DOME
    vec2 sI = vec2(1.0, 0.0);
    vec2 sJ = vec2(0.0, 1.0);
    #else
    vec4 cI = mvp * vec4(gridI, 1.0);
    vec4 cJ = mvp * vec4(gridJ, 1.0);
    vec2 sI = cI.w > 0.0 ? toScreen(cI) - vA : vec2(1.0, 0.0);
    vec2 sJ = cJ.w > 0.0 ? toScreen(cJ) - vA : vec2(0.0, 1.0);
    #endif
    // Eje de la celda mas parecido a la horizontal de la pantalla: las tarjetas y candados no giran.
    vec2 r = abs(sI.x) * length(sJ) > abs(sJ.x) * length(sI) ? sI : sJ;
    r = length(r) > 1e-4 ? normalize(r) : vec2(1.0, 0.0);
    vRight = r.x < 0.0 ? -r : r;
    vMarks = vec4(bit(marks, 1.0) * (1.0 - rim), bit(marks, 2.0), bit(marks, 4.0), target);
    vFolder = bit(marks, 8.0);
    vCard = bit(marks, 64.0) * step(0.001, uCardOn);
    vKind = mod(floor(marks / 128.0), 4.0);
    vRand = fract(sin(dot(A.xy, vec2(12.9898, 78.233))) * 43758.5453);
    // Pulso: un cometa que recorre el hilo (la fase de cada punto se afina en el fragmento).
    vPh = fract(uTime * uSpeed - phase);
    vPulse = uPulse * (1.0 - rim);
    // Cuadrado que envuelve los tramos y solo el brillo que llega a verse (hasta 1/255, con el pulso si
    // pasa por aqui), el punto y, si los hay, la tarjeta, la carpeta o el candado: el resto seria pintar
    // para nada.
    float hot = vPulse * (1.6 * exp(-vPh * uHead) + 0.5 * exp(-vPh * uTail)) * 0.8;
    float reach = log(max((uGlowAmt + hot) * uAlpha, 1e-4) / 0.004);
    float R = uLineW * 0.5 + uGlow * clamp(reach, 0.5, 5.0) + 1.0;
    R = max(R, uDotR * (target > 0.5 ? 14.0 : 1.5) + 1.0);
    float glyph = max(vFolder * 0.24, max(vMarks.z * 0.18, step(0.5, target) * 0.3));
    R = max(R, vCell * max(glyph, 0.37 * vCard) + 2.0);
    vec2 lo = min(vA, min(vM1, vM2)) - R;
    vec2 hi = max(vA, max(vM1, vM2)) + R;
    if (hi.x < 0.0 || hi.y < 0.0 || lo.x > uRes.x || lo.y > uRes.y) { cull(); return; }
    vec2 s = mix(lo, hi, position.xy);
    gl_Position = vec4(s / uRes * 2.0 - 1.0, 0.0, 1.0);
  }
`

export const THREAD_FRAGMENT = /* glsl */ `
  ${COMMON}
  uniform vec3 uGlowColor;
  uniform vec3 uCoreColor;
  uniform vec3 uNodeColor;
  uniform vec3 uPulseColor;
  uniform vec3 uInk;
  uniform float uLineW;
  uniform float uGlow;
  uniform float uDotR;
  uniform float uCore;
  uniform float uGlowAmt;
  uniform float uDots;
  uniform float uCardOn;
  uniform float uFolderOn;
  uniform float uLockOn;
  uniform float uLight;
  uniform vec4 uDim;
  uniform float uDimAmt;
  uniform vec4 uDim2;
  uniform float uDimAmt2;
  uniform vec4 uEdge;
  uniform float uEdgeAmt;
  uniform float uPage;
  uniform vec4 uPageRows;
  uniform float uPageDot;
  uniform vec4 uQuiet;
  uniform float uQuietAmt;
  uniform float uStep;
  uniform float uHead;
  uniform float uTail;

  // Distancia a un medio tramo que empieza en el nodo a y acaba en el punto medio m.
  float halfSeg(vec2 p, vec2 a, vec2 m) {
    vec2 am = m - a;
    float l2 = dot(am, am);
    if (l2 < 1e-6) return 1e4;
    float t = dot(p - a, am) / l2;
    if (t > 1.0) return 1e4;
    return length(p - a - am * max(t, 0.0));
  }
  float seg(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - a - ab * t);
  }
  float box(vec2 q, vec2 h, float r) {
    vec2 d = abs(q) - h + r;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
  }
  float line(float d, float w) { return 1.0 - smoothstep(w - 0.6, w + 0.6, d); }
  float rnd(float x) { return fract(sin(x) * 43758.5453); }
  // Penumbra de una caja (x0, y0, x1, y1): entera dentro y se va suavemente hacia fuera.
  float shade(vec2 p, vec4 r, float amount) {
    vec2 dq = max(vec2(r.x - p.x, p.y - r.w), max(vec2(p.x - r.z, r.y - p.y), vec2(0.0)));
    return 1.0 - amount * (1.0 - smoothstep(0.0, 70.0 * uDpr, length(dq)));
  }

  void main() {
    vec2 p = gl_FragCoord.xy;
    vec2 up = vec2(-vRight.y, vRight.x);
    vec2 q = vec2(dot(p - vA, vRight), dot(p - vA, up));
    float c = vCell;
    float d1 = halfSeg(p, vA, vM1);
    float d2 = halfSeg(p, vA, vM2);
    float d = min(d1, d2);
    float lock = vMarks.z * uLockOn;
    float target = vMarks.w;

    // Tarjeta de documento: caja con el dibujo de su tipo; el hilo llega hasta su borde. La objetivo,
    // al acercarse, se queda como pagina: renglones a la altura de los del titular y texto gris en el resto.
    float card = 0.0;
    float ink = 0.0;
    float hide = 0.0;
    if (vCard > 0.5) {
      float jit = target > 0.5 ? 1.0 : 0.93 + 0.1 * vRand;
      vec2 size = vec2(c * 0.29, c * 0.35) * jit;
      float b = box(q, size, min(c * 0.035, 22.0 * uDpr));
      hide = (1.0 - smoothstep(-1.0, 0.5, b)) * uCardOn;
      card = line(abs(b), 0.6 * uDpr) * uCardOn;
      float page = target * uPage;
      // Trazos de dentro: crecen con la tarjeta hasta un grosor de linea de texto.
      float tw = max(0.5 * uDpr, min(c * 0.011, 1.6 * uDpr));
      float glyph = 0.0;
      if (vKind < 0.5) {
        // Texto: titulo y renglones.
        for (int k = 0; k < 4; k++) {
          float y = c * (0.2 - 0.115 * float(k));
          float len = c * (k == 0 ? 0.22 : 0.18 + 0.2 * fract(vRand * (3.1 + float(k) * 1.7)));
          glyph = max(glyph, line(seg(q, vec2(-c * 0.19, y), vec2(-c * 0.19 + len, y)), k == 0 ? max(0.6, min(c * 0.022, 3.2 * uDpr)) : tw));
        }
      } else if (vKind < 1.5) {
        // PDF: banda de cabecera y renglones.
        glyph = (1.0 - smoothstep(-0.5, 0.5, box(q - vec2(0.0, c * 0.215), vec2(c * 0.2, c * 0.05), c * 0.012))) * 0.25;
        for (int k = 0; k < 3; k++) {
          float y = c * (0.07 - 0.11 * float(k));
          float len = c * (0.22 + 0.16 * fract(vRand * (5.3 + float(k) * 2.1)));
          glyph = max(glyph, line(seg(q, vec2(-c * 0.19, y), vec2(-c * 0.19 + len, y)), tw));
        }
      } else if (vKind < 2.5) {
        // Hoja de calculo: rejilla con la fila de cabecera rellena.
        vec2 g = (q + vec2(c * 0.2, c * 0.23)) / vec2(c * 0.4, c * 0.46);
        float inside = step(-0.01, g.x) * step(g.x, 1.01) * step(-0.01, g.y) * step(g.y, 1.01);
        float gy = abs(fract(g.y * 5.0 + 0.5) - 0.5) * c * 0.46 / 5.0;
        float gx = abs(fract(g.x * 3.0 + 0.5) - 0.5) * c * 0.4 / 3.0;
        glyph = max(line(gy, tw * 0.8), line(gx, tw * 0.8)) * inside;
        glyph = max(glyph, step(0.8, g.y) * inside * 0.22);
      } else {
        // Foto: marco, montana y sol.
        vec2 f = q - vec2(0.0, c * 0.01);
        glyph = line(abs(box(f, vec2(c * 0.21, c * 0.22), c * 0.02)), tw);
        float m = min(seg(f, vec2(-c * 0.17, -c * 0.15), vec2(-c * 0.05, c * 0.04)), seg(f, vec2(-c * 0.05, c * 0.04), vec2(c * 0.03, -c * 0.06)));
        m = min(m, min(seg(f, vec2(c * 0.03, -c * 0.06), vec2(c * 0.09, 0.0)), seg(f, vec2(c * 0.09, 0.0), vec2(c * 0.17, -c * 0.15))));
        glyph = max(glyph, line(m, tw));
        glyph = max(glyph, line(abs(length(f - vec2(c * 0.09, c * 0.12)) - c * 0.035), tw));
      }
      // Las cerradas solo llevan el candado; la pagina cambia el dibujo por sus renglones (primero se va uno y luego llegan los otros).
      ink = glyph * (1.0 - vMarks.z) * (1.0 - smoothstep(0.0, 0.45, page)) * uCardOn * (0.7 + 0.4 * fract(vRand * 7.31));
      if (page > 0.01) {
        // Renglon (r) cuya linea de base queda por debajo del punto y altura dentro de el (v, de 0 en la base a 1).
        float pitch = uPageRows.z * c;
        float first = uPageRows.x * c;
        float rowF = (first - q.y) / pitch;
        float r = ceil(rowF);
        float v = r - rowF;
        float base = min(v, 1.0 - v) * pitch;
        float mx = size.x - c * 0.045;
        float my = size.y - c * 0.05;
        float inPage = (1.0 - smoothstep(mx - 1.0, mx, abs(q.x))) * (1.0 - smoothstep(my - 1.0, my, abs(q.y)));
        float rule = line(base, 0.5 * uDpr) * 0.2;
        // En los renglones que no son del titular, tres lineas de texto pequeno, de largo distinto.
        float head = step(-0.5, r) * step(r, uPageRows.w - 0.5);
        float m = floor(v * 3.0);
        float len = (0.35 + 0.6 * rnd(r * 12.9898 + m * 4.1 + vRand * 78.233)) * 2.0 * mx;
        float ym = q.y + ((m + 0.5) / 3.0 - v) * pitch;
        float body = line(seg(q, vec2(-mx, ym), vec2(-mx + len, ym)), max(0.6 * uDpr, pitch * 0.022)) * (1.0 - head) * 0.24;
        // Rejilla de puntos en calma, la de las celdas del titular (las que no se encienden).
        float sd = uPageDot * c;
        vec2 near = (q / sd - floor(q / sd + 0.5)) * sd;
        float grid = (1.0 - smoothstep(0.75 * uDpr - 0.5, 0.75 * uDpr + 0.5, length(near))) * smoothstep(3.0 * uDpr, 5.0 * uDpr, sd) * 0.2;
        ink = max(ink, max(max(rule, body), grid) * inPage * smoothstep(0.25, 1.0, page));
      }
    }
    // Carpeta: una carpeta pequena en la vuelta del hilo.
    float folder = 0.0;
    if (vFolder * uFolderOn > 0.01) {
      vec2 f = q + vec2(0.0, c * 0.02);
      float bodyD = box(f, vec2(c * 0.22, c * 0.15), c * 0.025);
      float tabD = box(f - vec2(-c * 0.11, c * 0.16), vec2(c * 0.09, c * 0.035), c * 0.02);
      float fd = min(bodyD, tabD);
      folder = line(abs(fd), 0.65 * uDpr) * uFolderOn;
      hide = max(hide, (1.0 - smoothstep(-1.0, 0.5, fd)) * uFolderOn);
    }
    // Candado: las areas cerradas del equipo.
    float padlock = 0.0;
    if (lock > 0.01) {
      vec2 l = q / max(c, 1.0);
      float body = box(l - vec2(0.0, -0.045), vec2(0.095, 0.075), 0.018);
      float ring = abs(length(l - vec2(0.0, 0.03)) - 0.058) - 0.014;
      ring = l.y < 0.03 ? 1e3 : ring;
      float sd = min(body, ring) * c;
      padlock = (1.0 - smoothstep(-0.6, 0.6, sd)) * lock;
      hide = max(hide, (1.0 - smoothstep(-0.5, 0.5, length(q) - c * 0.16)) * lock * (1.0 - vCard));
    }

    float keep = 1.0 - hide;
    float hw = uLineW * 0.5;
    float core = line(d, hw) * keep;
    float glow = exp(-d / uGlow) * keep;
    float dn = length(p - vA);
    float rN = uDotR * (1.0 + target * 1.6);
    float bare = 1.0 - vCard * uCardOn;
    float node = (1.0 - smoothstep(rN - 0.6, rN + 0.6, dn)) * max(vMarks.y * uDots, target) * (1.0 - lock) * bare;
    float halo = exp(-dn / (uDotR * 3.5)) * target * bare;

    // Pulso: el punto del hilo mas cercano lleva la fase de su sitio en el medio tramo; cabeza brillante y cola corta.
    vec2 am = (d1 < d2 ? vM1 : vM2) - vA;
    float t = clamp(dot(p - vA, am) / max(dot(am, am), 1e-6), 0.0, 1.0);
    float ph = vPh + (d1 < d2 ? 0.5 : -0.5) * t * uStep;
    ph = ph < 0.0 ? ph + 1.0 : ph;
    float pulse = vPulse * (1.6 * exp(-ph * uHead) + 0.5 * exp(-ph * uTail));

    // El hilo fino no entra en la pagina del documento: alli solo va el titular.
    vec2 qd = max(uQuiet.xy - p, p - uQuiet.zw);
    float open = 1.0 - (1.0 - smoothstep(-2.0, 2.0, max(qd.x, qd.y))) * uQuietAmt;
    core *= open;
    glow *= open;
    node *= open;
    pulse *= open;

    // Detras del texto de la escena y de los instrumentos (arriba, abajo y el indice de la derecha), el
    // hilo se aparta en penumbra para que se lea.
    float nav = smoothstep(uEdge.z - 40.0 * uDpr, uEdge.z, p.x) * (1.0 - smoothstep(uEdge.w, uEdge.w + 40.0 * uDpr, abs(p.y - uRes.y * 0.5)));
    float band = max(max(smoothstep(uEdge.x - 40.0 * uDpr, uEdge.x, p.y), 1.0 - smoothstep(uEdge.y, uEdge.y + 40.0 * uDpr, p.y)), nav);
    float dim = min(shade(p, uDim, uDimAmt), shade(p, uDim2, uDimAmt2)) * (1.0 - uEdgeAmt * band);
    pulse *= dim;

    // El objetivo resalta: en oscuro, mas luz; en claro, en el azul de marca (mas luz lo aclararia).
    float lift = target * (1.0 - uLight);
    vec3 mark = mix(uNodeColor, uCoreColor, target * uLight);
    vec3 rgb = uGlowColor * glow * uGlowAmt
      + uCoreColor * core * uCore
      + uPulseColor * pulse * (core * 1.6 + glow * 0.8)
      + uNodeColor * (node + halo * 0.7)
      + mark * (card * (0.9 + lift * (1.4 - 0.9 * uPage)) + ink * (0.6 + lift * 0.5) + folder * (1.0 + lift))
      + uInk * padlock;
    float a = core * uCore + glow * uGlowAmt + pulse * core + node + halo * 0.5 + card + ink * 0.7 + folder + padlock;
    float f = vFade * dim;
    if (uLight > 0.5) {
      float alpha = clamp(a, 0.0, 1.0) * f;
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(rgb / max(a, 1e-3), alpha);
    } else {
      vec3 col = rgb * f;
      if (max(col.r, max(col.g, col.b)) < 0.002) discard;
      gl_FragColor = vec4(col, 1.0);
    }
  }
`

/** El titular: las celdas encendidas, cuadrados unidos por el hilo, que aparecen todas a la vez con un fundido. */
export const HEADLINE_VERTEX = /* glsl */ `
  attribute vec4 aCell;
  uniform vec2 uRes;
  uniform float uFade;
  varying vec2 vA;
  varying vec2 vP;
  varying vec2 vN;
  varying vec2 vRight;
  varying float vCell;
  varying float vHasP;
  varying float vHasN;

  vec2 toScreen(vec4 c) { return (c.xy / c.w * 0.5 + 0.5) * uRes; }
  vec3 stepTo(float k) {
    return k < 0.5 ? vec3(1.0, 0.0, 0.0) : k < 1.5 ? vec3(0.0, 1.0, 0.0) : k < 2.5 ? vec3(-1.0, 0.0, 0.0) : k < 3.5 ? vec3(0.0, -1.0, 0.0) : vec3(0.0);
  }

  void main() {
    if (uFade < 0.003) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); return; }
    float code = aCell.z;
    float kp = mod(code, 5.0);
    float kn = mod(floor(code / 5.0), 5.0);
    vHasP = step(kp, 3.5);
    vHasN = step(kn, 3.5);
    vec3 A = vec3(aCell.xy, 0.0);
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 cA = mvp * vec4(A, 1.0);
    vec4 cP = mvp * vec4(A + stepTo(kp) * 0.5, 1.0);
    vec4 cN = mvp * vec4(A + stepTo(kn) * 0.5, 1.0);
    vec4 cI = mvp * vec4(A + vec3(1.0, 0.0, 0.0), 1.0);
    vec4 cJ = mvp * vec4(A + vec3(0.0, 1.0, 0.0), 1.0);
    if (cA.w <= 0.0 || cI.w <= 0.0 || cJ.w <= 0.0) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); return; }
    vA = toScreen(cA);
    vP = toScreen(cP);
    vN = toScreen(cN);
    vec2 sI = toScreen(cI) - vA;
    vec2 sJ = toScreen(cJ) - vA;
    vCell = max(length(sI), length(sJ));
    vec2 r = abs(sI.x) * length(sJ) > abs(sJ.x) * length(sI) ? sI : sJ;
    r = normalize(r);
    vRight = r.x < 0.0 ? -r : r;
    float R = vCell * 0.75 + 3.0;
    vec2 s = mix(vA - R, vA + R, position.xy);
    gl_Position = vec4(s / uRes * 2.0 - 1.0, 0.0, 1.0);
  }
`

export const HEADLINE_FRAGMENT = /* glsl */ `
  uniform vec3 uInk;
  uniform float uLight;
  uniform float uDpr;
  uniform float uFade;
  varying vec2 vA;
  varying vec2 vP;
  varying vec2 vN;
  varying vec2 vRight;
  varying float vCell;
  varying float vHasP;
  varying float vHasN;

  float seg(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - a - ab * t);
  }

  void main() {
    vec2 p = gl_FragCoord.xy;
    vec2 up = vec2(-vRight.y, vRight.x);
    vec2 q = vec2(dot(p - vA, vRight), dot(p - vA, up));
    float c = vCell;
    // En claro, los cuadrados algo mas llenos para que la letra no se rompa.
    float hs = c * mix(0.37, 0.41, uLight);
    float rr = c * 0.12;
    vec2 qq = abs(q) - (hs - rr);
    float b = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0) - rr;
    float sq = 1.0 - smoothstep(-0.55, 0.55, b);
    // El hilo que une las celdas seguidas del titular.
    float w = max(0.45 * uDpr, c * 0.07);
    float dt = min(mix(1e4, seg(p, vA, vP), vHasP), mix(1e4, seg(p, vA, vN), vHasN));
    float trace = (1.0 - smoothstep(w - 0.5, w + 0.5, dt)) * 0.8;
    float glow = exp(-max(b, 0.0) / max(1.0, c * 0.5)) * 0.18;
    float a = max(sq, trace);
    vec3 rgb = uInk * (a + glow * (1.0 - uLight));
    if (uLight > 0.5) {
      float alpha = clamp(a, 0.0, 1.0) * uFade;
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(uInk, alpha);
    } else {
      vec3 col = rgb * uFade;
      if (max(col.r, max(col.g, col.b)) < 0.002) discard;
      gl_FragColor = vec4(col, 1.0);
    }
  }
`
