/* Catchment: the browser game. Rules live in rules.js; puzzles in data/puzzles.js. */
(function () {
  'use strict';

  const DATA = window.CATCHMENT_DATA;
  const Rules = window.CatchmentRules;
  const NET = DATA.network;
  const L = NET.about.segmentFeet; // one street, in feet
  const KPP = Rules.KIDS_PER_POINT;
  const MAX_CHECKS = 3;
  // Set by the published site (tools/build_site.js); the local copy keeps prototype defaults.
  const CFG = window.CATCHMENT_CONFIG || {};
  const SHARE_URL = CFG.shareUrl || ''; // link added to shared results
  const ALLOW_FUTURE = CFG.allowFuture !== undefined ? !!CFG.allowFuture : true; // browse boards ahead of their day

  const PIECES = {
    school: { name: 'School', icon: 'i-school', tip: 'Reaches the 3 streets at its corner.' },
    magnet: { name: 'Magnet', icon: 'i-magnet', tip: 'Goes on a school. Reaches one corner further.' },
    safe: { name: 'Safe Passage', icon: 'i-safe', tip: 'Kids walk through this corner for free.' },
  };
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const $ = (s) => document.querySelector(s);
  const fmt = (n) => n.toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r0 = (n) => Math.round(n);

  /* ---------------- storage (per-browser conveniences; the game works without it) */
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('catchment:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('catchment:' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ }
    },
  };

  /* ---------------- which board */
  function dayNumber(date) {
    const [y, m, d] = DATA.epoch.split('-').map(Number);
    const a = Date.UTC(y, m - 1, d);
    const b = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((b - a) / 86400000) + 1;
  }
  const todayNo = Math.max(1, dayNumber(new Date()));
  const lastNo = ALLOW_FUTURE ? DATA.puzzles.length : Math.min(todayNo, DATA.puzzles.length);

  let no, puzzle, board, st, best, tool, view = 'yours', showReal = false, hoverV = null, lastScore = null;

  function fromHash() {
    const m = /^#p(\d+)$/.exec(location.hash);
    return m ? Math.min(Math.max(1, +m[1]), lastNo) : null;
  }

  const puzzleNo = (n) => DATA.puzzles[(n - 1) % DATA.puzzles.length];
  const sigFor = (p) => `${p.date}|${p.best.pts}|${p.segs.length}|${JSON.stringify(p.layers || {})}`;
  /** Saved play for board n, or null (never played, or the puzzles were regenerated since). */
  function savedFor(n) {
    const s = store.get('board:' + n, null);
    return s && s.sig === sigFor(puzzleNo(n)) ? s : null;
  }

  function load(n) {
    no = n;
    puzzle = puzzleNo(n);
    board = Rules.makeBoard(NET, puzzle);
    best = Rules.fromGlobal(board, puzzle.best);
    st = savedFor(n) || { sig: sigFor(puzzle), pl: { schools: [], safe: [] }, checks: [], done: false, solved: false };
    view = 'yours';
    showReal = false;
    hoverV = null;
    lastScore = null;
    tool = firstTool();
    drawStatic();
    update();
  }

  const placement = () => Rules.fromGlobal(board, st.pl);
  const save = () => store.set('board:' + no, st);
  const isToday = () => no === todayNo;

  function left(piece, pl) {
    return (board.pieces[piece] || 0) - Rules.used(pl || placement())[piece];
  }
  function firstTool() {
    return ['school', 'magnet', 'safe'].find((p) => (board.pieces[p] || 0) > 0 && left(p) > 0) || 'school';
  }

  /* ---------------- SVG helpers */
  const svg = $('#board');
  const NS = 'http://www.w3.org/2000/svg';
  const path = (ring) => 'M' + ring.map((p) => p[0] + ' ' + p[1]).join('L') + 'Z';
  const mid = (s) => [(board.verts[s.a].x + board.verts[s.b].x) / 2, (board.verts[s.a].y + board.verts[s.b].y) / 2];

  const SYMBOLS = `
  <defs>
    <symbol id="i-school" viewBox="-1 -1 2 2"><circle class="sym-disc" r=".94"/><path class="sym-light" d="M-.5 .52V-.04L0-.5L.5-.04V.52Z"/><rect class="sym-ink" x="-.13" y=".16" width=".26" height=".36"/><circle class="sym-ink" cy="-.08" r=".12"/></symbol>
    <symbol id="i-magnet" viewBox="-1 -1 2 2"><path class="sym-magnet" d="M-.62-.7V.02A.62.62 0 0 0 .62 .02V-.7H.24V.02A.24.24 0 0 1-.24 .02V-.7Z"/><rect class="sym-light" x="-.62" y="-.7" width=".38" height=".22"/><rect class="sym-light" x=".24" y="-.7" width=".38" height=".22"/></symbol>
    <symbol id="i-safe" viewBox="-1 -1 2 2"><circle class="sym-safe" r=".94"/><rect class="sym-stripe" x="-.58" y="-.5" width=".19" height="1"/><rect class="sym-stripe" x="-.26" y="-.5" width=".19" height="1"/><rect class="sym-stripe" x=".06" y="-.5" width=".19" height="1"/><rect class="sym-stripe" x=".38" y="-.5" width=".19" height="1"/></symbol>
    <symbol id="i-cone" viewBox="-1 -1 2 2"><circle class="sym-ring" r=".9"/><path class="sym-cone" d="M-.13-.62H.13L.4 .36H-.4Z"/><rect class="sym-light" x="-.3" y="-.18" width=".6" height=".16"/><rect class="sym-cone" x="-.56" y=".36" width="1.12" height=".16" rx=".05"/></symbol>
    <symbol id="i-closed" viewBox="-1 -1 2 2"><circle class="sym-closed" r=".84"/><path class="sym-faint" d="M-.36 .4V0L0-.32L.36 0V.4Z"/><path class="sym-slash" d="M-.58-.58L.58 .58"/></symbol>
    <symbol id="i-train" viewBox="-1 -1 2 2"><rect class="sym-ink" x="-.62" y="-.82" width="1.24" height="1.26" rx=".3"/><rect class="sym-light" x="-.42" y="-.6" width=".84" height=".42" rx=".08"/><circle class="sym-light" cx="-.3" cy=".16" r=".12"/><circle class="sym-light" cx=".3" cy=".16" r=".12"/><path class="sym-legs" d="M-.36 .46L-.58 .9M.36 .46L.58 .9"/></symbol>
    <symbol id="i-tree" viewBox="-1 -1 2 2"><rect class="sym-tree" x="-.11" y=".05" width=".22" height=".85" rx=".05"/><circle class="sym-tree" cy="-.22" r=".64"/></symbol>
    <symbol id="i-cut" viewBox="-1 -1 2 2"><path class="sym-street" d="M-.95 0H.95"/><path class="sym-cutbar" d="M0-.62V.62"/></symbol>
    <symbol id="i-kid" viewBox="-1 -1 2 2"><circle class="sym-kid" r=".9"/><text class="sym-kid-ink" x="0" y=".05" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="1.05" text-anchor="middle" dominant-baseline="central">4</text></symbol>
  </defs>`;

  function use(id, x, y, size, cls) {
    return `<use href="#${id}" x="${r0(x - size / 2)}" y="${r0(y - size / 2)}" width="${r0(size)}" height="${r0(size)}"${cls ? ` class="${cls}"` : ''}/>`;
  }

  /* ---------------- static board: water, city, streets, kids, corners */
  let vb;
  function drawStatic() {
    const xs = board.verts.map((v) => v.x);
    const ys = board.verts.map((v) => v.y);
    const pad = 0.55 * L;
    vb = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad };
    vb.w = Math.max(...xs) + pad - vb.x;
    vb.h = Math.max(...ys) + pad - vb.y;
    svg.setAttribute('viewBox', `${r0(vb.x)} ${r0(vb.y)} ${r0(vb.w)} ${r0(vb.h)}`);

    const inView = (x, y, m) => x > vb.x - m && x < vb.x + vb.w + m && y > vb.y - m && y < vb.y + vb.h + m;
    const onBoard = new Set(puzzle.segs);
    let ghosts = '';
    NET.segs.forEach(([a, b], i) => {
      if (onBoard.has(i)) return;
      const [ax, ay] = NET.verts[a];
      const [bx, by] = NET.verts[b];
      if (inView(ax, ay, L) || inView(bx, by, L)) ghosts += `M${ax} ${ay}L${bx} ${by}`;
    });

    let streets = '';
    board.segs.forEach((s) => {
      const a = board.verts[s.a];
      const b = board.verts[s.b];
      streets += `M${a.x} ${a.y}L${b.x} ${b.y}`;
    });

    const on = board.layers || {};
    const near = (ring) => ring.some(([x, y]) => inView(x, y, L));
    const line = (pts) => 'M' + pts.map((p) => p[0] + ' ' + p[1]).join('L');
    const parks = on.parks ? NET.parkShapes.filter(near).map((r) => `<path class="park" d="${path(r)}"/>`).join('') : '';
    const roads = on.barriers ? `<path class="road" d="${NET.roads.filter(near).map(line).join('')}"/>` : '';
    const routeLines = on.routes ? `<path class="route-line" d="${NET.routeLines.filter(near).map(line).join('')}"/>` : '';

    // L links: one dashed line per line color, side by side where lines share a link
    let rail = '';
    const pairs = new Map();
    board.verts.forEach((v, i) => v.rail.forEach(([w, code]) => {
      if (i < w) {
        const k = i + ':' + w;
        pairs.set(k, [...(pairs.get(k) || []), code]);
      }
    }));
    for (const [k, codes] of pairs) {
      const [i, w] = k.split(':').map(Number);
      const a = board.verts[i];
      const b = board.verts[w];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      codes.forEach((code, j) => {
        const off = (j - (codes.length - 1) / 2) * 0.05 * L;
        const d = `M${r0(a.x + nx * off)} ${r0(a.y + ny * off)}L${r0(b.x + nx * off)} ${r0(b.y + ny * off)}`;
        rail += `<path class="rail-case" d="${d}"/><path class="rail" d="${d}" style="stroke:${NET.lines[code][1]}"><title>${esc(NET.lines[code][0])}</title></path>`;
      });
    }

    // walks cut by an expressway or river: a gap in the street and a bar across it
    let cuts = '';
    board.segs.forEach((s) => s.cut.forEach((c) => {
      if (!c) return;
      const a = board.verts[s.a];
      const b = board.verts[s.b];
      const ux = (b.x - a.x) / L;
      const uy = (b.y - a.y) / L;
      const g = 0.07 * L;
      const h = 0.13 * L;
      cuts += `<g class="cutmark"><title>${c.type === 'river' ? 'River' : 'Expressway'}: no crossing nearby</title>` +
        `<path class="cut-gap" d="M${r0(c.x - ux * g)} ${r0(c.y - uy * g)}L${r0(c.x + ux * g)} ${r0(c.y + uy * g)}"/>` +
        `<path class="cut" d="M${r0(c.x - uy * h)} ${r0(c.y + ux * h)}L${r0(c.x + uy * h)} ${r0(c.y - ux * h)}"/></g>`;
    }));

    let corners = '';
    let features = '';
    let badges = '';
    board.verts.forEach((v) => {
      if (v.kind === 'roadwork') features += use('i-cone', v.x, v.y, 0.44 * L);
      else if (v.kind === 'closed') features += `<g><title>${esc(v.closed)} closed in 2013</title>${use('i-closed', v.x, v.y, 0.42 * L)}</g>`;
      else corners += `<circle class="corner" cx="${v.x}" cy="${v.y}" r="${r0(0.035 * L)}"/>`;
      const slots = gaps(v);
      const marks = [];
      if (v.station) marks.push(['i-train', `${v.station} (L station)`, NET.lines[v.rail[0] ? v.rail[0][1] : 'red'][1]]);
      if (v.free === 'park') marks.push(['i-tree', `${v.park}`, null]);
      if (v.free === 'route') marks.push(['i-safe', 'Safe Passage route', null]);
      marks.forEach(([icon, title, ring], j) => {
        const [dx, dy] = slots[j % slots.length];
        const x = v.x + dx * 0.31 * L;
        const y = v.y + dy * 0.31 * L;
        badges += `<g class="badge"><title>${esc(title)}</title>` +
          (icon === 'i-safe' ? use('i-safe', x, y, 0.2 * L) :
            `<circle class="badge-bg" cx="${r0(x)}" cy="${r0(y)}" r="${r0(0.105 * L)}"${ring ? ` style="stroke:${ring}"` : ''}/>${use(icon, x, y, 0.14 * L)}`) +
          '</g>';
      });
    });

    let hits = '';
    board.verts.forEach((v, i) => {
      const streetsHere = v.inc.reduce((t, si) => t + board.segs[si].kids, 0);
      const label = [describe(i) || 'Corner', `${v.inc.length} streets`, `about ${fmt(Math.round(streetsHere / KPP) * KPP)} kids`].join(', ');
      hits += `<circle class="hit" data-v="${i}" cx="${v.x}" cy="${v.y}" r="${r0(0.31 * L)}" tabindex="0" role="button" aria-label="${esc(label)}"/>`;
    });

    svg.innerHTML = `${SYMBOLS}
      <rect class="bg" x="${r0(vb.x - L)}" y="${r0(vb.y - L)}" width="${r0(vb.w + 2 * L)}" height="${r0(vb.h + 2 * L)}"/>
      <g>${NET.city.map((r) => `<path class="city" d="${path(r)}"/>`).join('')}</g>
      <g>${parks}</g>
      <g>${NET.lake.map((r) => `<path class="lake" d="${path(r)}"/>`).join('')}${NET.water.map((r) => `<path class="water" d="${path(r)}"/>`).join('')}</g>
      ${roads}${routeLines}
      <path class="ghost" d="${ghosts}"/>
      <g id="g-reach"></g>
      <path class="street" d="${streets}"/>
      <g>${rail}</g>
      <g id="g-preview"></g>
      <g>${cuts}${corners}${features}${badges}</g>
      <g id="g-kids"></g>
      <g id="g-pieces"></g>
      <g id="g-real"></g>
      <g id="g-gain"></g>
      <g id="g-hits">${hits}</g>`;

    drawLocator();
    const d = new Date(puzzle.date + 'T12:00:00Z');
    $('#meta').textContent = `No. ${no} · ${DAYS[d.getUTCDay()]} · ${puzzle.theme}${no > todayNo ? ' · Preview' : ''}`;
    $('#area').textContent = puzzle.area;
    $('#legend').textContent = `${puzzle.blurb} Each street is about ${(L / 5280).toFixed(1)} mi long; kids walk about ${(L / 2 / 5280).toFixed(1)} mi to the corner.`;
    $('#btn-today').hidden = isToday() || todayNo > lastNo;
    $('#score-sub').textContent = `of ${fmt(board.totalPts * KPP)} kids on this board`;
    const has = present();
    document.querySelectorAll('#dlg-help [data-feature]').forEach((li) => { li.hidden = !has[li.dataset.feature]; });
    const FEATS = [
      ['rail', 'i-train', 'L: ride one stop'], ['parks', 'i-tree', 'Park: walk through free'],
      ['routes', 'i-safe', 'Safe route: walk through free'], ['barriers', 'i-cut', 'No crossing'],
      ['closed', 'i-closed', 'Closed in 2013'], ['roadwork', 'i-cone', 'Roadwork'],
    ];
    $('#key-feats').innerHTML = FEATS.filter(([k]) => has[k]).map(([, icon, label]) =>
      `<span class="feat"><svg viewBox="-1 -1 2 2" aria-hidden="true"><use href="#${icon}" x="-1" y="-1" width="2" height="2"/></svg>${label}</span>`).join('');
    drawPieceButtons();
  }

  /** Which features are on today's board (drives the help list and the key). */
  function present() {
    return {
      magnet: (board.pieces.magnet || 0) > 0,
      safe: (board.pieces.safe || 0) > 0,
      roadwork: board.verts.some((v) => v.kind === 'roadwork'),
      closed: board.verts.some((v) => v.kind === 'closed'),
      barriers: board.segs.some((s) => s.cut[0] || s.cut[1]),
      parks: board.verts.some((v) => v.free === 'park'),
      routes: board.verts.some((v) => v.free === 'route'),
      rail: board.verts.some((v) => v.rail.length > 0),
    };
  }

  /** Unit directions from corner v that point between its streets, topmost first. */
  function gaps(v) {
    const s = board.segs[v.inc[0]];
    const o = board.verts[s.a === board.verts.indexOf(v) ? s.b : s.a];
    const base = Math.atan2(o.y - v.y, o.x - v.x);
    return [1, 3, 5].map((k) => base + (k * Math.PI) / 3)
      .map((t) => [Math.cos(t), Math.sin(t)])
      .sort((p, q) => p[1] - q[1]);
  }

  /** Plain-language description of what is special about corner v. */
  function describe(v) {
    const c = board.verts[v];
    const out = [];
    if (c.station) out.push(`${c.station} L station: kids can ride one stop`);
    if (c.free === 'park') out.push(`${c.park}: kids walk through for free`);
    if (c.free === 'route') out.push('Safe Passage route: kids walk through for free');
    if (c.kind === 'closed') out.push(`${c.closed} closed in 2013`);
    if (c.kind === 'roadwork') out.push('Roadwork');
    return out.join(' · ');
  }

  function drawLocator() {
    const loc = $('#locator');
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    NET.city.forEach((ring) => ring.forEach(([x, y]) => {
      minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
    }));
    const p = 1500;
    loc.setAttribute('viewBox', `${minx - p} ${miny - p} ${maxx - minx + 2 * p} ${maxy - miny + 2 * p}`);
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    loc.innerHTML = NET.city.map((r) => `<path class="city" d="${path(r)}"/>`).join('') +
      `<circle class="here" cx="${r0(cx)}" cy="${r0(cy)}" r="${r0(Math.max(vb.w, vb.h) * 0.38)}"/>`;
  }

  /* ---------------- dynamic layers */
  function update() {
    const pl = view === 'best' ? best : placement();
    const ev = Rules.evaluate(board, pl);
    const mine = view === 'best' ? Rules.evaluate(board, placement()) : ev;
    const tone = view === 'best' ? ' best' : '';

    // reach underlay
    let reach = '';
    board.segs.forEach((s, i) => {
      if (ev.cover[i] > 0) {
        const a = board.verts[s.a];
        const b = board.verts[s.b];
        reach += `M${a.x} ${a.y}L${b.x} ${b.y}`;
      }
    });
    $('#g-reach').innerHTML = reach ? `<path class="reach${tone}" d="${reach}"/>` : '';

    // kids
    let kids = '';
    const rr = 0.15 * L;
    board.segs.forEach((s, i) => {
      const [x, y] = mid(s);
      if (s.pts === 0) {
        kids += `<g class="kid zero"><circle cx="${r0(x)}" cy="${r0(y)}" r="${r0(0.05 * L)}"/></g>`;
        return;
      }
      const cls = ['kid', 'b' + (s.pts >= 8 ? 7 : s.pts >= 6 ? 6 : s.pts)];
      if (ev.cover[i] > 0) cls.push('on');
      if (ev.cover[i] > 1 && view !== 'best') cls.push('twice');
      if (view === 'best') cls.push('best');
      kids += `<g class="${cls.join(' ')}"><circle cx="${r0(x)}" cy="${r0(y)}" r="${r0(rr)}"/><text x="${r0(x)}" y="${r0(y + 0.01 * L)}">${s.pts}</text></g>`;
    });
    $('#g-kids').innerHTML = kids;

    // pieces
    let pieces = '';
    for (const v of pl.safe || []) {
      const c = board.verts[v];
      pieces += use('i-safe', c.x, c.y, 0.4 * L);
    }
    for (const s of pl.schools) {
      const c = board.verts[s.v];
      if (s.magnet) pieces += `<circle class="ring${tone}" cx="${c.x}" cy="${c.y}" r="${r0(0.29 * L)}"/>`;
      pieces += `<g class="${view === 'best' ? 'sym-best' : ''}">${use('i-school', c.x, c.y, 0.44 * L)}</g>`;
      if (s.magnet) pieces += use('i-magnet', c.x + 0.22 * L, c.y - 0.24 * L, 0.2 * L);
    }
    $('#g-pieces').innerHTML = pieces;

    // real schools overlay
    let real = '';
    if (showReal) {
      for (const i of puzzle.real) {
        const [x, y, name] = NET.schools[i];
        const s = 0.13 * L;
        real += `<g class="real"><title>${esc(name)}</title><rect x="${r0(x - s / 2)}" y="${r0(y - s / 2)}" width="${r0(s)}" height="${r0(s)}" transform="rotate(45 ${r0(x)} ${r0(y)})"/></g>`;
      }
    }
    $('#g-real').innerHTML = real;

    // hit targets
    const locked = st.done;
    svg.classList.toggle('locked', locked);
    document.querySelectorAll('#g-hits .hit').forEach((h) => {
      const v = +h.dataset.v;
      const ok = !locked && actionFor(v) !== null;
      h.classList.toggle('ok', ok);
      h.classList.toggle('no', !ok);
    });

    drawPreview();

    // dock
    const scoreEl = $('#score');
    scoreEl.textContent = fmt(mine.kids);
    if (lastScore !== null && lastScore !== mine.kids) {
      scoreEl.classList.remove('bump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('bump');
    }
    lastScore = mine.kids;
    $('#waste').textContent = mine.wasted > 0 && view !== 'best' ? `${fmt(mine.wasted * KPP)} kids reached by two schools` : '';
    drawPieceButtons();
    drawChecks(mine);
    $('#views').hidden = !st.done;
    document.querySelectorAll('.view-btn').forEach((b) => {
      const on = b.dataset.view === 'real' ? showReal : b.dataset.view === view;
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** What tapping corner v would do with the current tool: {kind, pl} or null. */
  function actionFor(v) {
    const pl = placement();
    const school = pl.schools.find((s) => s.v === v);
    if (tool === 'magnet' && school && !school.magnet && left('magnet', pl) > 0) {
      return { kind: 'place', pl: Rules.place(pl, 'magnet', v) };
    }
    if (school || pl.safe.includes(v)) return { kind: 'pick', pl: Rules.pickUp(pl, v) };
    if (Rules.whyNot(board, pl, tool, v)) return null;
    return { kind: 'place', pl: Rules.place(pl, tool, v) };
  }

  function drawPreview() {
    const gp = $('#g-preview');
    const gg = $('#g-gain');
    gp.innerHTML = '';
    gg.innerHTML = '';
    if (hoverV === null || st.done || view !== 'yours') return;
    const act = actionFor(hoverV);
    const pl = placement();
    const about = describe(hoverV);
    if (!act) {
      const why = Rules.whyNot(board, pl, tool, hoverV);
      if (why) setHint(about && !why.includes('closed') ? `${about}. ${why}` : why);
      return;
    }
    const before = Rules.evaluate(board, pl);
    const after = Rules.evaluate(board, act.pl);
    let d = '';
    board.segs.forEach((s, i) => {
      if (after.cover[i] > 0 && before.cover[i] === 0) {
        const a = board.verts[s.a];
        const b = board.verts[s.b];
        d += `M${a.x} ${a.y}L${b.x} ${b.y}`;
      }
    });
    if (act.kind === 'place') gp.innerHTML = d ? `<path class="preview" d="${d}"/>` : '';
    const delta = after.kids - before.kids;
    const c = board.verts[hoverV];
    const text = act.kind === 'pick' ? `Pick up · ${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))}` : `+${fmt(delta)}`;
    const w = text.length * 0.6 * 520 + 0.2 * L; // label font is 520 board-feet tall (see .gain text)
    const y = c.y - 0.5 * L;
    gg.innerHTML = `<g class="gain"><rect x="${r0(c.x - w / 2)}" y="${r0(y - 0.16 * L)}" width="${r0(w)}" height="${r0(0.32 * L)}" rx="${r0(0.16 * L)}"/><text x="${r0(c.x)}" y="${r0(y + 0.01 * L)}">${text}</text></g>`;
    setHint((about ? about + '. ' : '') + (act.kind === 'pick' ? 'Tap to pick this piece back up.' : `${PIECES[tool].name}: reaches ${fmt(delta)} more kids here.`));
  }

  function drawPieceButtons() {
    const wrap = $('#pieces');
    const pl = placement();
    const kinds = ['school', 'magnet', 'safe'].filter((p) => (board.pieces[p] || 0) > 0);
    wrap.innerHTML = kinds.map((p) => {
      const n = left(p, pl);
      return `<button class="piece" data-piece="${p}" aria-pressed="${p === tool}"${st.done ? ' disabled' : ''}>
        <svg viewBox="-1 -1 2 2" aria-hidden="true"><use href="#${PIECES[p].icon}" x="-1" y="-1" width="2" height="2"/></svg>
        <span class="name">${PIECES[p].name}<span class="tip">${PIECES[p].tip}</span></span>
        <span class="left" aria-label="${n} left">${n}/${board.pieces[p]}</span>
      </button>`;
    }).join('');
  }

  function drawChecks(ev) {
    const used = st.checks.length;
    $('#pips').innerHTML = Array.from({ length: MAX_CHECKS }, (_, i) => `<i class="${i < used ? 'used' : ''}"></i>`).join('');
    const btn = $('#btn-check');
    const same = used && st.checks[used - 1].key === key(st.pl);
    btn.disabled = st.done || ev.pts === 0 || same;
    btn.textContent = st.done ? 'Done' : `Check · ${MAX_CHECKS - used} left`;
    $('#btn-clear').disabled = st.done || placement().schools.length + placement().safe.length === 0;
    $('#history').innerHTML = st.checks.map((c, i) =>
      `<li><span class="sq ${sqClass(c.pct)}"></span><span>Check ${i + 1}: ${fmt(c.pts * KPP)} kids</span><b>${c.pct}%</b></li>`).join('');
    $('#btn-result').hidden = !st.done;
    if (!hoverV && hoverV !== 0) {
      if (st.done) setHint(st.solved ? 'You found the best district.' : 'Out of checks. Compare your district with the best one.');
      else if (same) setHint('Move a piece before checking again.');
      else if (used === 0 && ev.pts === 0) setHint(`${PIECES[tool].name}: tap a corner to place it.`);
      else setHint(`${puzzle.blurb}`);
    }
  }

  const key = (g) => JSON.stringify([g.schools.map((s) => s.join(':')).sort(), [...g.safe].sort()]);
  const sqClass = (pct) => (pct >= 100 ? 's100' : pct >= 95 ? 's95' : pct >= 85 ? 's85' : '');
  const sqEmoji = (pct) => (pct >= 100 ? '🟩' : pct >= 95 ? '🟨' : pct >= 85 ? '🟧' : '⬜');
  function setHint(t) { $('#hint').textContent = t; }

  /* ---------------- actions */
  function tapCorner(v) {
    if (st.done) { toast('This board is finished. Switch views above the map.'); return; }
    if (view !== 'yours') { view = 'yours'; }
    const act = actionFor(v);
    if (!act) {
      toast(Rules.whyNot(board, placement(), tool, v) || 'Nothing to do here.');
      return;
    }
    st.pl = Rules.toGlobal(board, act.pl);
    save();
    if (left(tool) <= 0) tool = firstTool();
    update();
    const last = document.querySelector('#g-pieces > :last-child');
    if (last && act.kind === 'place') last.classList.add('pop');
  }

  function check() {
    const ev = Rules.evaluate(board, placement());
    if (st.done || ev.pts === 0) return;
    const pct = ev.pts >= puzzle.best.pts ? 100 : Math.floor((100 * ev.pts) / puzzle.best.pts);
    st.checks.push({ pts: ev.pts, pct, key: key(st.pl) });
    if (pct >= 100) finish(true);
    else if (st.checks.length >= MAX_CHECKS) finish(false);
    save();
    update();
    if (!st.done) toast(`${pct}% of the best district. ${MAX_CHECKS - st.checks.length} ${MAX_CHECKS - st.checks.length === 1 ? 'check' : 'checks'} left.`);
  }

  function finish(solved) {
    st.done = true;
    st.solved = solved;
    if (isToday()) {
      const s = store.get('stats', { played: 0, solved: 0, streak: 0, maxStreak: 0, lastWin: 0, dist: { 1: 0, 2: 0, 3: 0, x: 0 } });
      s.played++;
      if (solved) {
        s.solved++;
        s.streak = s.lastWin === no - 1 ? s.streak + 1 : 1;
        s.lastWin = no;
        s.maxStreak = Math.max(s.maxStreak, s.streak);
        s.dist[st.checks.length]++;
      } else {
        s.streak = 0;
        s.dist.x++;
      }
      store.set('stats', s);
    }
    setTimeout(showResult, 450);
  }

  function shareText() {
    const top = Math.max(...st.checks.map((c) => c.pct));
    const lines = [
      `Catchment No. ${no} · ${puzzle.area}`,
      `${st.checks.map((c) => sqEmoji(c.pct)).join(' ')}  ${st.solved ? `${st.checks.length}/${MAX_CHECKS}` : `${top}% of best`}`,
    ];
    if (SHARE_URL) lines.push(SHARE_URL);
    return lines.join('\n');
  }

  function showResult() {
    const top = st.checks.reduce((a, c) => (c.pct > a.pct ? c : a), st.checks[0]);
    $('#res-eyebrow').textContent = `No. ${no} · ${puzzle.area}`;
    $('#res-title').textContent = st.solved
      ? (st.checks.length === 1 ? 'Best district, first try' : 'You found the best district')
      : 'Out of checks';
    $('#res-pct').textContent = `${top.pct}%`;
    const n = board.pieces.school;
    $('#res-line').textContent = st.solved
      ? `Your ${n} schools reach ${fmt(top.pts * KPP)} kids, as many as any district can on this board.`
      : `Your best check reached ${fmt(top.pts * KPP)} kids. The best district reaches ${fmt(puzzle.best.pts * KPP)}.`;
    $('#share-text').textContent = shareText();
    const names = puzzle.real.map((i) => NET.schools[i][2]).sort();
    $('#irl-text').textContent = names.length
      ? `You had ${n} schools. Inside this same patch of ${puzzle.area}, Chicago Public Schools runs ${names.length} elementary ${names.length === 1 ? 'school' : 'schools'}.`
      : `No CPS elementary school sits fully inside this patch of ${puzzle.area}.`;
    // every 2013 closure inside the board's complete hexes, on a corner or not
    const H = (Math.sqrt(3) / 2) * L;
    const centers = new Map();
    board.segs.forEach((sg) => {
      const a = board.verts[sg.a];
      const b = board.verts[sg.b];
      const nx = -(b.y - a.y) / L;
      const ny = (b.x - a.x) / L;
      for (const k of [1, -1]) {
        const cx = (a.x + b.x) / 2 + k * nx * H;
        const cy = (a.y + b.y) / 2 + k * ny * H;
        const id = `${Math.round(cx / 50)},${Math.round(cy / 50)}`;
        const e = centers.get(id) || { cx, cy, n: 0 };
        e.n++;
        centers.set(id, e);
      }
    });
    const full = [...centers.values()].filter((e) => e.n === 6);
    const onCorner = new Set(board.verts.filter((v) => v.kind === 'closed').map((v) => v.id));
    const closedHere = (NET.closures || [])
      .filter(([x, y, , c]) => (board.layers.closed && onCorner.has(c)) || full.some((e) => Math.hypot(x - e.cx, y - e.cy) <= H * 1.02))
      .map((c) => c[2]);
    if (closedHere.length) {
      $('#irl-text').textContent += ` ${closedHere.length === 1 ? 'One school' : `${closedHere.length} schools`} on this board closed in 2013: ${closedHere.join(', ')}.`;
    }
    $('#irl-names').textContent = names.join(', ');
    $('#irl-more').hidden = names.length === 0;
    $('#btn-see-real').hidden = names.length === 0;
    tickCountdown();
    const dlg = $('#dlg-result');
    if (!dlg.open) dlg.showModal();
  }

  function tickCountdown() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(0, Math.round((next - now) / 60000));
    $('#next').textContent = isToday()
      ? `Next board in ${mins >= 60 ? `${Math.floor(mins / 60)} h ` : ''}${mins % 60} min.`
      : `Today's board is No. ${todayNo}.`;
    $('#btn-res-archive').hidden = lastNo < 2;
  }

  /* ---------------- archive: a calendar of every board so far, newest month first */
  function showArchive() {
    const released = Math.min(todayNo, DATA.puzzles.length);
    const months = new Map();
    for (let n = 1; n <= lastNo; n++) {
      const [y, m, d] = puzzleNo(n).date.split('-').map(Number);
      const k = y * 12 + m - 1;
      if (!months.has(k)) months.set(k, { y, m, days: new Map() });
      months.get(k).days.set(d, n);
    }
    let finished = 0;
    let found = 0;
    const dow = DAYS.map((d) => `<span class="arc-dow" aria-hidden="true">${d[0]}</span>`).join('');
    const html = [...months.values()].reverse().map(({ y, m, days }) => {
      const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
      let cells = '';
      for (let d = 1; d <= length; d++) {
        const col = d === 1 && first ? ` style="grid-column-start:${first + 1}"` : '';
        const n = days.get(d);
        if (!n) { cells += `<span class="arc-day empty"${col} aria-hidden="true"><span class="d">${d}</span></span>`; continue; }
        const s = savedFor(n);
        const cls = ['arc-day'];
        let marks = '';
        let status = 'not played';
        if (s && s.checks.length) {
          marks = s.checks.map((c) => `<i class="sq ${sqClass(c.pct)}"></i>`).join('');
          const top = Math.max(...s.checks.map((c) => c.pct));
          if (s.solved) status = `best district in ${s.checks.length} ${s.checks.length === 1 ? 'check' : 'checks'}`;
          else status = s.done ? `finished, ${top}% of best` : `${top}% of best so far`;
        } else if (s && (s.pl.schools.length || s.pl.safe.length)) {
          marks = '<i class="dot"></i>';
          status = 'started';
        }
        if (s && s.done && n <= released) { finished++; if (s.solved) found++; }
        if (s && s.solved) cls.push('solved');
        if (n === todayNo) cls.push('is-today');
        if (n > released) cls.push('preview');
        const label = `No. ${n}, ${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MONTHS[m - 1]} ${d}${n === todayNo ? ', today' : ''}: ${status}`;
        cells += `<button class="${cls.join(' ')}" data-n="${n}"${col}${n === no ? ' aria-current="true"' : ''} aria-label="${esc(label)}">` +
          `<span class="d">${d}</span><span class="marks">${marks}</span></button>`;
      }
      return `<section class="arc-month"><h3>${MONTHS[m - 1]} ${y}</h3><div class="arc-grid">${dow}${cells}</div></section>`;
    }).join('');
    $('#arc-months').innerHTML = html;
    $('#arc-summary').textContent = `${released} ${released === 1 ? 'board' : 'boards'} so far. ` +
      (finished ? `You've finished ${finished}${found ? `, and found the best district on ${found}` : ''}.` : 'Tap a day to play it.');
    const dlg = $('#dlg-archive');
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }

  function showAbout() {
    const dlg = $('#dlg-about');
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  const DIALOGS = { 'dlg-archive': showArchive, 'dlg-about': showAbout, 'dlg-stats': () => showStats(), 'dlg-help': () => $('#dlg-help').showModal() };

  function showStats() {
    const s = store.get('stats', { played: 0, solved: 0, streak: 0, maxStreak: 0, dist: { 1: 0, 2: 0, 3: 0, x: 0 } });
    const pct = s.played ? Math.round((100 * s.solved) / s.played) : 0;
    $('#stat-grid').innerHTML = [[s.played, 'Played'], [pct, 'Best found %'], [s.streak, 'Streak'], [s.maxStreak, 'Longest streak']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    const max = Math.max(1, ...Object.values(s.dist));
    $('#dist').innerHTML = [['1', 1], ['2', 2], ['3', 3], ['✗', 'x']].map(([label, k]) => {
      const v = s.dist[k] || 0;
      const hi = st.done && isToday() && ((st.solved && String(st.checks.length) === String(k)) || (!st.solved && k === 'x'));
      return `<div class="bar"><span>${label}</span><span class="fill${hi ? ' hi' : ''}" style="width:${Math.max(8, (100 * v) / max)}%">${v}</span></div>`;
    }).join('');
    $('#dlg-stats').showModal();
  }

  let toastTimer;
  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------------- events */
  svg.addEventListener('click', (e) => {
    const h = e.target.closest('.hit');
    if (h) tapCorner(+h.dataset.v);
  });
  svg.addEventListener('keydown', (e) => {
    const h = e.target.closest && e.target.closest('.hit');
    if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tapCorner(+h.dataset.v); }
  });
  svg.addEventListener('pointerover', (e) => {
    const h = e.target.closest('.hit');
    if (!h || e.pointerType !== 'mouse') return;
    hoverV = +h.dataset.v;
    drawPreview();
  });
  svg.addEventListener('focusin', (e) => {
    const h = e.target.closest('.hit');
    if (!h || !h.matches(':focus-visible')) return;
    hoverV = +h.dataset.v;
    drawPreview();
  });
  const clearHover = () => { hoverV = null; drawPreview(); drawChecks(Rules.evaluate(board, placement())); };
  svg.addEventListener('pointerout', (e) => { if (e.target.closest('.hit')) clearHover(); });
  svg.addEventListener('focusout', clearHover);

  $('#pieces').addEventListener('click', (e) => {
    const b = e.target.closest('.piece');
    if (!b || b.disabled) return;
    tool = b.dataset.piece;
    if (left(tool) <= 0) toast(`No ${PIECES[tool].name.toLowerCase()} pieces left. Tap one on the board to pick it up.`);
    update();
  });
  $('#btn-check').addEventListener('click', check);
  $('#btn-clear').addEventListener('click', () => {
    st.pl = { schools: [], safe: [] };
    tool = firstTool();
    save();
    update();
  });
  $('#btn-result').addEventListener('click', showResult);
  $('#views').addEventListener('click', (e) => {
    const b = e.target.closest('.view-btn');
    if (!b) return;
    if (b.dataset.view === 'real') showReal = !showReal;
    else view = b.dataset.view;
    update();
  });
  $('#btn-see-best').addEventListener('click', () => { view = 'best'; $('#dlg-result').close(); update(); });
  $('#btn-see-real').addEventListener('click', () => { showReal = true; $('#dlg-result').close(); update(); });
  $('#btn-copy').addEventListener('click', () => {
    const text = shareText();
    const done = () => toast('Result copied');
    const fallback = () => {
      const r = document.createRange();
      r.selectNodeContents($('#share-text'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      toast('Selected. Copy it to share.');
    };
    try {
      navigator.clipboard.writeText(text).then(done, fallback);
    } catch (e) { fallback(); }
  });
  $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
  $('#btn-stats').addEventListener('click', showStats);
  $('#btn-archive').addEventListener('click', showArchive);
  $('#btn-about').addEventListener('click', showAbout);
  // any [data-open] button (in the rules, the result) swaps to that dialog
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (!b || !DIALOGS[b.dataset.open]) return;
    const from = b.closest('dialog');
    if (from) from.close();
    DIALOGS[b.dataset.open]();
  });
  $('#arc-months').addEventListener('click', (e) => {
    const b = e.target.closest('.arc-day[data-n]');
    if (!b) return;
    $('#dlg-archive').close();
    go(+b.dataset.n);
  });
  const go = (n) => {
    if (n < 1 || n > lastNo) return;
    const h = n === todayNo ? '' : '#p' + n;
    if (location.hash === h) load(n);
    else location.hash = h;
  };
  $('#btn-today').addEventListener('click', () => go(todayNo));
  // #about opens the About page over whatever board is showing; closing it drops the hash
  const ABOUT = '#about';
  window.addEventListener('hashchange', () => {
    if (location.hash === ABOUT) { showAbout(); return; }
    load(fromHash() || todayNo);
  });
  $('#dlg-about').addEventListener('close', () => {
    if (location.hash === ABOUT) history.replaceState(null, '', location.pathname + location.search);
  });
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { go(no + (e.key === 'ArrowLeft' ? -1 : 1)); return; }
    const kinds = ['school', 'magnet', 'safe'].filter((p) => (board.pieces[p] || 0) > 0);
    const i = Number(e.key) - 1;
    if (i >= 0 && i < kinds.length) { tool = kinds[i]; update(); }
  });

  /* ---------------- start */
  load(fromHash() || todayNo);
  if (location.hash === ABOUT) {
    showAbout();
  } else if (!store.get('seenHelp', false)) {
    store.set('seenHelp', true);
    $('#dlg-help').showModal();
  } else if (st.done) {
    setTimeout(showResult, 300);
  }
})();
