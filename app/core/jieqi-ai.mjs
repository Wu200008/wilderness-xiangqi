import { legalMoves, applyMove, publicState, inCheck } from './rules.mjs';

/** A CPU-only, public-information Monte Carlo player for mixed-colour Jieqi.
 * Every edge is an action chosen before its chance outcome is drawn. Different
 * public reveals lead to different child nodes; no concealed board is sampled
 * once and then handed to a perfect-information opponent.
 */
export const DIFFICULTY_BUDGETS = Object.freeze({ easy: 150, medium: 600, hard: 1800 });
export const ENGINE_NAME = '混揭概率搜索';
const VALUES = Object.freeze({ k: 100000, r: 900, n: 430, c: 450, b: 220, a: 220, p: 120 });
const TYPES = ['r', 'n', 'b', 'a', 'c', 'p'];
const SIDES = ['red', 'black'];
const opposite = side => side === 'red' ? 'black' : 'red';
const moveKey = move => `${move.from}-${move.to}`;
const now = () => globalThis.performance?.now() ?? Date.now();

function randomGenerator(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function copyPool(pool) {
  if (!pool) throw new Error('混揭 AI 需要公开的 remainingPool 身份计数。');
  return Object.fromEntries(SIDES.map(side => [side,
    Object.fromEntries(TYPES.map(type => [type, Number(pool[side]?.[type] ?? 0)]))]));
}

function drawIdentity(pool, random) {
  let count = 0;
  for (const side of SIDES) for (const type of TYPES) count += pool[side][type];
  if (count <= 0) throw new Error('公开暗子身份池已空，无法模拟揭子。');
  let choice = random() * count;
  for (const side of SIDES) for (const type of TYPES) {
    choice -= pool[side][type];
    if (choice < 0) {
      pool[side][type]--;
      return { side, type };
    }
  }
  throw new Error('公开暗子身份池计数无效。');
}

function chanceOptions(state, move, random) {
  const source = state.board[move.from];
  const target = state.board[move.to];
  if (!source.covered && !target?.covered) return { options: {}, key: '-' };
  const pool = copyPool(state.remainingPool);
  const options = {};
  // Both revelations sample the common pool without replacement. Capturing a
  // covered piece discloses its identity even if its actual colour is our own.
  if (target?.covered) options.captureReveal = drawIdentity(pool, random);
  if (source.covered) options.reveal = drawIdentity(pool, random);
  const code = piece => piece ? `${piece.side[0]}${piece.type}` : '-';
  return { options, key: `${code(options.captureReveal)}/${code(options.reveal)}` };
}

function terminalValue(state, rootSide) {
  const status = state.result;
  if (status?.status === 'ended') return status.winner ? (status.winner === rootSide ? 1 : -1) : 0;
  const generals = new Set(state.board.filter(piece => piece?.type === 'k' && !piece.covered).map(piece => piece.side));
  if (!generals.has(rootSide)) return -1;
  if (!generals.has(opposite(rootSide))) return 1;
  return null;
}

function capturesGeneral(state, move) {
  const target = state.board[move.to];
  return target && !target.covered && target.type === 'k' && target.side !== state.turn;
}

function positionalValue(piece, square) {
  const x = square % 9;
  const y = Math.floor(square / 9);
  const advance = piece.side === 'red' ? 9 - y : y;
  const centrality = 4 - Math.abs(4 - x);
  if (piece.type === 'p') return advance * 9 + (advance >= 5 ? 35 : 0) + centrality * 3;
  if (piece.type === 'n') return centrality * 9 + Math.min(advance, 6) * 3;
  if (piece.type === 'r' || piece.type === 'c') return centrality * 4 + Math.min(advance, 6) * 2;
  return piece.type === 'k' ? 0 : centrality * 3;
}

function evaluate(state, rootSide) {
  const terminal = terminalValue(state, rootSide);
  if (terminal !== null) return terminal;
  let value = 0;
  let poolCount = 0;
  let poolValue = 0;
  if (state.remainingPool) for (const side of SIDES) for (const type of TYPES) {
    const count = Number(state.remainingPool[side]?.[type] ?? 0);
    poolCount += count;
    poolValue += count * VALUES[type] * (side === rootSide ? 1 : -1);
  }
  const expectedDarkValue = poolCount ? poolValue / poolCount : 0;
  for (let square = 0; square < 90; square++) {
    const piece = state.board[square];
    if (!piece || piece.type === 'k') continue;
    const sign = piece.side === rootSide ? 1 : -1;
    if (piece.covered) {
      // The identity's colour is unknown. Its temporary controller retains a
      // small move/capture option, not the face-down placeholder's full value.
      value += expectedDarkValue + sign * (65 + positionalValue(piece, square) * 0.35);
    } else value += sign * (VALUES[piece.type] + positionalValue(piece, square));
  }
  if (inCheck(state, rootSide)) value -= 120;
  if (inCheck(state, opposite(rootSide))) value += 120;
  return Math.tanh(value / 1600);
}

function movePriority(state, move) {
  const piece = state.board[move.from];
  const target = state.board[move.to];
  if (capturesGeneral(state, move)) return 1000000;
  let value = target ? (target.covered ? 85 : VALUES[target.type]) : 0;
  value += (positionalValue(piece, move.to) - positionalValue(piece, move.from)) * 0.6;
  if (piece.covered) value -= 25;
  if (piece.type === 'k') value -= 8;
  return value;
}

function createNode(state, rootSide) {
  const terminal = terminalValue(state, rootSide);
  if (terminal !== null) return { state, visits: 0, edges: [], terminal };
  const moves = legalMoves(state);
  if (!moves.length) return { state, visits: 0, edges: [], terminal: state.turn === rootSide ? -1 : 1 };
  const winning = moves.find(move => capturesGeneral(state, move));
  const edges = moves.map(move => ({ move, prior: movePriority(state, move), visits: 0, total: 0, outcomes: new Map() }))
    .sort((a, b) => b.prior - a.prior || a.move.from - b.move.from || a.move.to - b.move.to);
  return { state, visits: 0, edges, terminal: winning ? (state.turn === rootSide ? 1 : -1) : null, winning };
}

function selectEdge(node, rootSide, exploration) {
  const unvisited = node.edges.find(edge => edge.visits === 0);
  if (unvisited) return unvisited;
  const sign = node.state.turn === rootSide ? 1 : -1;
  const logarithm = Math.log(node.visits + 1);
  let best = node.edges[0];
  let bestValue = -Infinity;
  for (const edge of node.edges) {
    const score = sign * edge.total / edge.visits
      + exploration * Math.sqrt(logarithm / edge.visits)
      + Math.tanh(edge.prior / 600) * 0.12 / (edge.visits + 1);
    if (score > bestValue) { bestValue = score; best = edge; }
  }
  return best;
}

function rollout(node, rootSide, random, plies, shouldStop) {
  let current = node;
  for (let depth = 0; depth < plies; depth++) {
    if (current.terminal !== null) return current.terminal;
    if (shouldStop()) break;
    // Choose the action from observable tactics before drawing its identity.
    const candidates = current.edges.slice(0, Math.min(4, current.edges.length));
    const selected = random() < 0.8 ? candidates[0] : candidates[Math.floor(random() * candidates.length)];
    const sampled = chanceOptions(current.state, selected.move, random);
    const next = applyMove(current.state, selected.move, sampled.options);
    current = createNode(next, rootSide);
  }
  return current.terminal ?? evaluate(current.state, rootSide);
}

/**
 * Synchronous bounded search, intended to run in a disposable Web Worker.
 * Input may be publicState(game) or a game: it is immediately reduced to the
 * public observation. `maxIterations` plus `seed` enables reproducible tests;
 * wall-clock budgets intentionally do not promise identical iteration counts.
 * timeMs may be set explicitly up to 120000 for user-selected thinking time.
 */
export function chooseMove(input, options = {}) {
  const started = now();
  const difficulty = Object.hasOwn(DIFFICULTY_BUDGETS, options.difficulty) ? options.difficulty : 'medium';
  const requestedMs = Number(options.timeMs ?? DIFFICULTY_BUDGETS[difficulty]);
  const budgetMs = Number.isFinite(requestedMs) ? Math.max(1, Math.min(120000, requestedMs)) : DIFFICULTY_BUDGETS[difficulty];
  const maxIterations = Number.isFinite(options.maxIterations) ? Math.max(0, Math.floor(options.maxIterations)) : Infinity;
  const maxDepth = Math.max(1, Math.min(24, Number(options.maxDepth) || ({ easy: 4, medium: 7, hard: 10 }[difficulty])));
  const random = randomGenerator(options.seed ?? 0x51A6C0DE);
  const state = publicState(input);
  const rootSide = state.turn;
  const root = createNode(state, rootSide);
  let iterations = 0;
  let nodes = 1;
  let chanceSamples = 0;
  let cancelled = false;
  const shouldStop = () => {
    cancelled = Boolean(options.signal?.aborted || options.isCancelled?.());
    return cancelled || now() - started >= budgetMs;
  };
  const response = (move, score, extra = {}) => ({
    move, score,
    stats: { engine: ENGINE_NAME, difficulty, budgetMs, elapsedMs: Math.round(now() - started), iterations, nodes, chanceSamples, cancelled, ...extra },
  });
  if (options.signal?.aborted || options.isCancelled?.()) { cancelled = true; return response(null, 0); }
  if (root.winning) return response(root.winning, 1, { immediateWin: true });
  if (!root.edges.length) return response(null, root.terminal ?? 0);

  while (iterations < maxIterations && !shouldStop()) {
    let node = root;
    const visitedNodes = [root];
    const visitedEdges = [];
    let value = null;
    for (let depth = 0; depth < maxDepth; depth++) {
      if (node.terminal !== null) { value = node.terminal; break; }
      if (shouldStop()) { value = evaluate(node.state, rootSide); break; }
      const edge = selectEdge(node, rootSide, difficulty === 'easy' ? 1.0 : 0.8);
      const sampled = chanceOptions(node.state, edge.move, random);
      if (sampled.key !== '-') chanceSamples++;
      visitedEdges.push(edge);
      let next = edge.outcomes.get(sampled.key);
      if (!next) {
        next = createNode(applyMove(node.state, edge.move, sampled.options), rootSide);
        nodes++;
        // Bound memory during long custom thinking times. Transient children
        // can still be evaluated after the persistent tree reaches its limit.
        if (nodes <= 30000) edge.outcomes.set(sampled.key, next);
        visitedNodes.push(next);
        value = rollout(next, rootSide, random, difficulty === 'easy' ? 1 : 2, shouldStop);
        break;
      }
      node = next;
      visitedNodes.push(node);
    }
    if (value === null) value = evaluate(node.state, rootSide);
    for (const visited of visitedNodes) visited.visits++;
    for (const edge of visitedEdges) { edge.visits++; edge.total += value; }
    iterations++;
  }
  if (cancelled) return response(null, 0);
  const evaluated = root.edges.filter(edge => edge.visits > 0);
  const ranked = (evaluated.length ? evaluated : root.edges).slice().sort((a, b) => {
    const quality = edge => edge.visits ? edge.total / edge.visits - 0.1 / Math.sqrt(edge.visits) : -Infinity;
    return quality(b) - quality(a) || b.visits - a.visits || b.prior - a.prior || moveKey(a.move).localeCompare(moveKey(b.move));
  });
  const best = ranked[0];
  return response(best.move, best.visits ? best.total / best.visits : evaluate(state, rootSide), {
    evaluatedMoves: evaluated.length,
    legalMoves: root.edges.length,
    candidates: ranked.slice(0, 5).map(edge => ({ move: edge.move, visits: edge.visits, score: edge.visits ? edge.total / edge.visits : null })),
  });
}

export default chooseMove;
