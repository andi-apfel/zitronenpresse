// Strichfiguren-Renderer: Posen als Hüfte + Rumpfwinkel + Zielpunkte für Hände/Füße (IK)
const FIG = (() => {
  const L = { torso: 26, neck: 9, headR: 6, ua: 14, fa: 13, th: 19, sh: 19 };
  const FLOOR = 92;
  const rad = (d) => (d * Math.PI) / 180;
  const along = (p, deg, len) => [p[0] + Math.cos(rad(deg)) * len, p[1] - Math.sin(rad(deg)) * len];

  function ik(root, target, a, b, bend) {
    let dx = target[0] - root[0], dy = target[1] - root[1];
    let d = Math.hypot(dx, dy) || 0.001;
    const dMax = a + b - 0.01, dMin = Math.abs(a - b) + 0.01;
    const dc = Math.min(dMax, Math.max(dMin, d));
    const phi = Math.atan2(dy, dx);
    const cosA = (a * a + dc * dc - b * b) / (2 * a * dc);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const ang = phi + bend * alpha;
    const joint = [root[0] + Math.cos(ang) * a, root[1] + Math.sin(ang) * a];
    const end = [root[0] + (dx / d) * dc, root[1] + (dy / d) * dc];
    return [joint, end];
  }

  // Pose-Felder, die zwischen A und B interpoliert werden
  const NUM = ['t', 'h', 'rope'];
  const PTS = ['hip', 'fR', 'fL', 'hR', 'hL', 'kneeR', 'kneeL'];
  function lerpPose(A, B, k) {
    if (!B) return A;
    const P = Object.assign({}, A);
    NUM.forEach((f) => { if (A[f] != null && B[f] != null) P[f] = A[f] + (B[f] - A[f]) * k; });
    PTS.forEach((f) => {
      if (A[f] && B[f]) P[f] = [A[f][0] + (B[f][0] - A[f][0]) * k, A[f][1] + (B[f][1] - A[f][1]) * k];
    });
    return P;
  }

  function solve(P) {
    const front = !!P.front;
    const hip = P.hip;
    const sh = along(hip, P.t, L.torso);
    const head = along(sh, P.h != null ? P.h : P.t, L.neck);
    const ox = front ? 7 : 0, hx = front ? 5 : 0;
    const shR = [sh[0] + ox, sh[1]], shL = [sh[0] - ox, sh[1]];
    const hipR = [hip[0] + hx, hip[1]], hipL = [hip[0] - hx, hip[1]];
    const kb = P.kb != null ? P.kb : -1, kbL = P.kbL != null ? P.kbL : kb;
    const eb = P.eb != null ? P.eb : 1, ebL = P.ebL != null ? P.ebL : eb;
    const fixKnee = (hp, kn, ft) => {
      const d = Math.hypot(kn[0] - hp[0], kn[1] - hp[1]) || 1;
      const k = [hp[0] + (kn[0] - hp[0]) / d * L.th, hp[1] + (kn[1] - hp[1]) / d * L.th];
      const e = Math.hypot(ft[0] - k[0], ft[1] - k[1]) || 1;
      return [k, [k[0] + (ft[0] - k[0]) / e * L.sh, k[1] + (ft[1] - k[1]) / e * L.sh]];
    };
    const [kR, fR] = P.kneeR ? fixKnee(hipR, P.kneeR, P.fR) : ik(hipR, P.fR, L.th, L.sh, kb);
    const [kL, fL] = P.kneeL ? fixKnee(hipL, P.kneeL, P.fL || P.fR) : ik(hipL, P.fL || P.fR, L.th, L.sh, kbL);
    const [eR, wR] = ik(shR, P.hR, L.ua, L.fa, eb);
    const [eL, wL] = ik(shL, P.hL || P.hR, L.ua, L.fa, ebL);
    return { front, hip, hipR, hipL, sh, shR, shL, head, kR, fR, kL, fL, eR, wR, eL, wL };
  }

  const f1 = (n) => Math.round(n * 10) / 10;
  const line = (a, b, cls) => `<line class="${cls}" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;
  const poly = (pts, cls) => `<polyline class="${cls}" points="${pts.map((p) => f1(p[0]) + ',' + f1(p[1])).join(' ')}"/>`;

  function dumbbell(p, front) {
    if (front) {
      return `<g class="p-db"><rect x="${f1(p[0] - 6)}" y="${f1(p[1] - 1.2)}" width="12" height="2.4" rx="1"/><rect x="${f1(p[0] - 7.5)}" y="${f1(p[1] - 4)}" width="3" height="8" rx="1"/><rect x="${f1(p[0] + 4.5)}" y="${f1(p[1] - 4)}" width="3" height="8" rx="1"/></g>`;
    }
    return `<g class="p-db"><circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="4.4"/><circle class="p-db-hole" cx="${f1(p[0])}" cy="${f1(p[1])}" r="1.3"/></g>`;
  }

  function propsBack(props) {
    let s = '';
    const pr = props || {};
    if (pr.mat) s += `<rect class="p-mat" x="${pr.mat[0]}" y="${FLOOR - 1}" width="${pr.mat[1] - pr.mat[0]}" height="3" rx="1.5"/>`;
    if (pr.wall != null) s += `<rect class="p-furn" x="${pr.wall}" y="8" width="5" height="${FLOOR - 8}"/>`;
    if (pr.door != null) s += `<rect class="p-door" x="${pr.door}" y="2" width="12" height="${FLOOR - 2}" rx="1"/>`;
    ['sofa', 'chair', 'box'].forEach((k) => {
      if (!pr[k]) return;
      const [x, y, w] = pr[k];
      if (k === 'sofa') {
        s += `<rect class="p-furn" x="${x}" y="${y}" width="${w}" height="${FLOOR - y}" rx="4"/>`;
        s += `<rect class="p-furn2" x="${x}" y="${y - 20}" width="9" height="${FLOOR - y + 20}" rx="4"/>`;
      } else if (k === 'chair') {
        s += `<rect class="p-furn" x="${x}" y="${y}" width="${w}" height="4" rx="1.5"/>`;
        s += `<rect class="p-furn" x="${x + 2}" y="${y}" width="3" height="${FLOOR - y}"/><rect class="p-furn" x="${x + w - 5}" y="${y}" width="3" height="${FLOOR - y}"/>`;
      } else {
        s += `<rect class="p-furn" x="${x}" y="${y}" width="${w}" height="${FLOOR - y}" rx="2"/>`;
      }
    });
    s += `<line class="p-floor" x1="4" y1="${FLOOR + 1.5}" x2="156" y2="${FLOOR + 1.5}"/>`;
    return s;
  }

  function propsFront(pr, J, P) {
    let s = '';
    pr = pr || {};
    if (pr.bandAnchor) {
      s += line(pr.bandAnchor, J.wR, 'p-band');
    }
    if (pr.bandHands) s += line(J.wR, J.wL, 'p-band');
    if (pr.bandBack) s += `<path class="p-band p-nofill" d="M${f1(J.wR[0])},${f1(J.wR[1])} Q${f1(J.sh[0] - 4)},${f1(J.sh[1] - 14)} ${f1(J.hip[0] - 4)},${f1(J.hip[1] - 4)}"/>`;
    if (pr.bandKnees) {
      if (J.front) s += line(J.kR, J.kL, 'p-band');
      else s += `<ellipse class="p-band p-nofill" cx="${f1((J.kR[0] + J.kL[0]) / 2)}" cy="${f1((J.kR[1] + J.kL[1]) / 2)}" rx="3.2" ry="4.2"/>`;
    }
    if (pr.bandFeet) s += line(J.fR, J.fL, 'p-band');
    if (pr.roller) s += `<g class="p-roller"><circle cx="${f1(J.wR[0])}" cy="${f1(FLOOR - 5)}" r="5.2"/><circle class="p-db-hole" cx="${f1(J.wR[0])}" cy="${f1(FLOOR - 5)}" r="1.6"/></g>`;
    if (pr.db) { s += dumbbell(J.wL, J.front); s += dumbbell(J.wR, J.front); }
    if (pr.dbR) s += dumbbell(J.wR, J.front);
    if (pr.dbHip) s += dumbbell([J.hip[0] + 1, J.hip[1] - 6], false);
    if (pr.rope && P.rope != null) {
      const a = J.wR, b = J.wL;
      const cy = P.rope;
      s += `<path class="p-rope p-nofill" d="M${f1(a[0])},${f1(a[1])} C${f1(a[0] + 14)},${f1(cy)} ${f1(b[0] - 36)},${f1(cy)} ${f1(b[0] - 2)},${f1(b[1])}"/>`;
    }
    return s;
  }

  function svgInner(ex, k) {
    const P = lerpPose(ex.A, ex.B, k || 0);
    const J = solve(P);
    let s = propsBack(ex.props);
    // hinteres Bein/Arm heller
    s += `<g class="fig-far">${poly([J.hipL, J.kL, J.fL], 'limb')}${poly([J.shL, J.eL, J.wL], 'limb')}</g>`;
    if (J.front) s += line(J.hipL, J.hipR, 'limb') + line(J.shL, J.shR, 'limb');
    s += line(J.hip, J.sh, 'limb torso');
    s += `<circle class="head" cx="${f1(J.head[0])}" cy="${f1(J.head[1])}" r="${L.headR}"/>`;
    s += poly([J.hipR, J.kR, J.fR], 'limb');
    s += poly([J.shR, J.eR, J.wR], 'limb');
    s += propsFront(ex.props, J, P);
    return s;
  }

  function svg(ex, k, cls) {
    return `<svg class="fig ${cls || ''}" viewBox="0 0 160 100" aria-hidden="true">${svgInner(ex, k)}</svg>`;
  }

  // Endlos-Animation für die Detailansicht
  function animate(el, ex) {
    let raf = 0, t0 = performance.now();
    const dur = (ex.dur || 2.6) * 1000;
    const svgEl = el;
    function frame(now) {
      const ph = ((now - t0) % dur) / dur;
      const k = 0.5 - 0.5 * Math.cos(ph * 2 * Math.PI);
      svgEl.innerHTML = svgInner(ex, k);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }

  return { svg, svgInner, animate, FLOOR };
})();
