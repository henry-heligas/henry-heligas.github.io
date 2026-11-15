/*
 * Catchment rules engine.
 *
 * Shared by the browser game (window.CatchmentRules) and the Node puzzle
 * tools (require('./rules.js')), so the score a player sees and the "best
 * possible" score the generator computes always come from the same code.
 *
 * The board
 *   Streets are hex sides ("segments"). Kids live at each segment's midpoint.
 *   Corners ("intersections") are where three streets meet.
 *
 * The pieces
 *   School        on an open corner. Reaches the streets that meet there.
 *   Magnet        on one of your schools. Its reach goes one corner further.
 *   Safe Passage  on any corner without a school (and not already free).
 *                 Walking through it is free, so any school's reach carries on
 *                 through it. It also opens Roadwork on that corner.
 *
 * Fixed board features (the real ones come from the city; each puzzle says
 * which real layers are switched on)
 *   Roadwork      no one can walk through this corner, and no school here.
 *   Closed        a school that closed in 2013: no school here, but walkable.
 *   Barrier       an expressway or river with no crossing nearby cuts a kid's
 *                 walk from their street to one of its corners.
 *   Park          walking through a park corner is free (like a Safe Passage).
 *   Safe route    a real CPS Safe Passage route: also free to walk through.
 *   L station     kids can ride the L one stop, to the next station corner on
 *                 the line, for free. One ride per trip.
 *
 * Reach, precisely: walking from the school, every corner you pass through
 * costs 1 step (0 if it is free; Roadwork can't be passed unless a Safe
 * Passage opens it). Walking along a street needs both halves of it open.
 * One L ride per trip is free. A plain school may spend 0 steps, a Magnet 1.
 * A street is reached from a reachable corner if the walk from the street to
 * that corner is not cut. Each kid counts once, however many schools reach
 * them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatchmentRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KIDS_PER_POINT = 100;
  const LAYERS = ['barriers', 'closed', 'parks', 'routes', 'rail'];

  /** Build a playable board (local indices) from the city network and a puzzle. */
  function makeBoard(net, puzzle) {
    const on = puzzle.layers || {};
    const vMap = new Map();
    const verts = [];
    const local = (gv) => {
      if (!vMap.has(gv)) {
        vMap.set(gv, verts.length);
        verts.push({ id: gv, x: net.verts[gv][0], y: net.verts[gv][1], inc: [], kind: null, free: null, rail: [], names: [] });
      }
      return vMap.get(gv);
    };
    const segs = puzzle.segs.map((gid) => {
      const [ga, gb, kids] = net.segs[gid];
      return { id: gid, a: local(ga), b: local(gb), kids, pts: Math.round(kids / KIDS_PER_POINT), open: [true, true], cut: [null, null] };
    });
    segs.forEach((s, i) => {
      verts[s.a].inc.push(i);
      verts[s.b].inc.push(i);
    });
    const segIndex = new Map(segs.map((s, i) => [s.id, i]));
    const here = (gv) => vMap.get(gv);

    if (on.barriers) {
      for (const [gid, end, x, y, type] of net.blocked || []) {
        const i = segIndex.get(gid);
        if (i === undefined) continue;
        segs[i].open[end] = false;
        segs[i].cut[end] = { x, y, type };
      }
    }
    if (on.closed) {
      for (const [, , name, gv] of net.closures || []) {
        const v = here(gv);
        if (v === undefined) continue;
        verts[v].kind = 'closed';
        verts[v].closed = (verts[v].closed ? verts[v].closed + ', ' : '') + name;
      }
    }
    if (on.parks) {
      for (const [gv, name] of net.parks || []) {
        const v = here(gv);
        if (v !== undefined) { verts[v].free = 'park'; verts[v].park = name; }
      }
    }
    if (on.routes) {
      for (const gv of net.routes || []) {
        const v = here(gv);
        if (v !== undefined && !verts[v].free) verts[v].free = 'route';
      }
    }
    if (on.rail) {
      for (const [, , name, gv, lines] of net.stations || []) {
        const v = here(gv);
        if (v !== undefined) verts[v].station = (verts[v].station ? verts[v].station + ' / ' : '') + name;
        void lines;
      }
      for (const [ga, gb, code] of net.rail || []) {
        const a = here(ga);
        const b = here(gb);
        if (a === undefined || b === undefined) continue;
        verts[a].rail.push([b, code]);
        verts[b].rail.push([a, code]);
      }
    }
    // Puzzle-specific features. Roadwork wins over anything else on its corner.
    for (const g of puzzle.closed || []) if (here(g) !== undefined) verts[here(g)].kind = 'closed';
    for (const g of puzzle.hazards || []) if (here(g) !== undefined) verts[here(g)].kind = 'roadwork';

    const totalPts = segs.reduce((t, s) => t + s.pts, 0);
    return { verts, segs, vMap, pieces: puzzle.pieces, layers: on, totalPts };
  }

  function other(seg, v) {
    return seg.a === v ? seg.b : seg.a;
  }
  function openAt(seg, v) {
    return seg.a === v ? seg.open[0] : seg.open[1];
  }

  /**
   * Streets reached by a school at corner v.
   * @param safe Uint8Array (or array) flagging corners that hold a Safe Passage.
   * @returns array of segment indices
   */
  function reach(board, v, magnet, safe) {
    const budget = magnet ? 1 : 0;
    const { verts, segs } = board;
    // State = corner * 2 + (already rode the L ? 1 : 0). 0-1 BFS on steps spent.
    const cost = new Map([[v * 2, 0]]);
    const deque = [v * 2];
    const passable = (w) => !!safe[w] || verts[w].kind !== 'roadwork';
    const free = (w) => !!safe[w] || !!verts[w].free;
    const relax = (state, c, front) => {
      if (c > budget) return;
      if (!cost.has(state) || c < cost.get(state)) {
        cost.set(state, c);
        if (front) deque.unshift(state);
        else deque.push(state);
      }
    };
    while (deque.length) {
      const st = deque.shift();
      const u = st >> 1;
      const rode = st & 1;
      const cu = cost.get(st);
      for (const si of verts[u].inc) {
        const s = segs[si];
        const w = other(s, u);
        if (!openAt(s, u) || !openAt(s, w) || !passable(w)) continue;
        const f = free(w);
        relax(w * 2 + rode, cu + (f ? 0 : 1), f);
      }
      if (!rode) {
        for (const [w] of verts[u].rail) {
          if (passable(w)) relax(w * 2 + 1, cu, true);
        }
      }
    }
    const out = new Set();
    for (const st of cost.keys()) {
      const u = st >> 1;
      for (const si of verts[u].inc) if (openAt(segs[si], u)) out.add(si);
    }
    return [...out];
  }

  function safeMask(board, placement) {
    const m = new Uint8Array(board.verts.length);
    for (const v of placement.safe || []) m[v] = 1;
    return m;
  }

  /**
   * Score a placement.
   * placement = { schools: [{ v, magnet }], safe: [v] }  (local corner indices)
   */
  function evaluate(board, placement) {
    const safe = safeMask(board, placement);
    const cover = new Int16Array(board.segs.length);
    const reaches = placement.schools.map((s) => {
      const r = reach(board, s.v, s.magnet, safe);
      for (const si of r) cover[si]++;
      return r;
    });
    let pts = 0;
    let wasted = 0;
    board.segs.forEach((s, i) => {
      if (cover[i] > 0) pts += s.pts;
      if (cover[i] > 1) wasted += s.pts * (cover[i] - 1);
    });
    return { pts, kids: pts * KIDS_PER_POINT, cover, reaches, wasted };
  }

  function used(placement) {
    return {
      school: placement.schools.length,
      magnet: placement.schools.filter((s) => s.magnet).length,
      safe: (placement.safe || []).length,
    };
  }

  /** Can this kind of piece ever sit on corner v (ignoring what is already placed)? */
  function cornerAllows(board, piece, v) {
    const c = board.verts[v];
    if (piece === 'school') {
      if (c.kind === 'roadwork') return 'Roadwork: no school here.';
      if (c.kind === 'closed') return 'This school closed in 2013. No new school opens here.';
    } else if (piece === 'safe') {
      if (c.free === 'park') return 'Kids already walk through this park for free.';
      if (c.free === 'route') return 'This corner is already on a Safe Passage route.';
    }
    return null;
  }

  /** Why a piece can't go on corner v, or null if it can. */
  function whyNot(board, placement, piece, v) {
    const school = placement.schools.find((s) => s.v === v);
    const hasSafe = (placement.safe || []).includes(v);
    const u = used(placement);
    const left = (board.pieces[piece] || 0) - u[piece];
    if (piece === 'school') {
      const fixed = cornerAllows(board, 'school', v);
      if (fixed) return fixed;
      if (school) return 'There is already a school here.';
      if (hasSafe) return 'A Safe Passage is here.';
    } else if (piece === 'magnet') {
      if (!school) return 'Magnets go on one of your schools.';
      if (school.magnet) return 'This school is already a magnet.';
    } else if (piece === 'safe') {
      if (school) return 'There is a school here.';
      if (hasSafe) return 'There is already a Safe Passage here.';
      const fixed = cornerAllows(board, 'safe', v);
      if (fixed) return fixed;
    }
    if (left <= 0) return 'None left.';
    return null;
  }

  function place(placement, piece, v) {
    const p = { schools: placement.schools.map((s) => ({ ...s })), safe: [...(placement.safe || [])] };
    if (piece === 'school') p.schools.push({ v, magnet: false });
    else if (piece === 'magnet') p.schools.find((s) => s.v === v).magnet = true;
    else if (piece === 'safe') p.safe.push(v);
    return p;
  }

  /** Pick up the top piece on corner v (a magnet before its school). */
  function pickUp(placement, v) {
    const p = { schools: placement.schools.map((s) => ({ ...s })), safe: [...(placement.safe || [])] };
    const school = p.schools.find((s) => s.v === v);
    if (school && school.magnet) school.magnet = false;
    else if (school) p.schools = p.schools.filter((s) => s.v !== v);
    else if (p.safe.includes(v)) p.safe = p.safe.filter((x) => x !== v);
    else return null;
    return p;
  }

  /** Placement in local indices <-> global corner ids (for storage and sharing). */
  function toGlobal(board, placement) {
    return {
      schools: placement.schools.map((s) => [board.verts[s.v].id, s.magnet ? 1 : 0]),
      safe: (placement.safe || []).map((v) => board.verts[v].id),
    };
  }
  function fromGlobal(board, g) {
    return {
      schools: (g.schools || []).map(([id, m]) => ({ v: board.vMap.get(id), magnet: !!m })),
      safe: (g.safe || []).map((id) => board.vMap.get(id)),
    };
  }

  return { KIDS_PER_POINT, LAYERS, makeBoard, reach, evaluate, used, cornerAllows, whyNot, place, pickUp, toGlobal, fromGlobal };
});
