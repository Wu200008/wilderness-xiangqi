/** Pure rules for standard Xiangqi and the local mixed-color covered variant.
 * Indices are y * 9 + x, black starts at y=0, red starts at y=9.
 * Covered pieces expose only their original slot's side/type. Their random
 * identity exists exclusively in `hidden` until moved or captured.
 */
export const SIDES = Object.freeze(['red', 'black']);
export const TYPES = Object.freeze(['r', 'n', 'b', 'a', 'k', 'c', 'p']);
const NON_KING_COUNTS = Object.freeze({ r: 2, n: 2, b: 2, a: 2, c: 2, p: 5 });
const PLAYING = Object.freeze({ status: 'playing', winner: null, reason: null });
const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const HORSE = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]];

export const otherSide = side => side === 'red' ? 'black' : 'red';
const xOf = square => square % 9;
const yOf = square => Math.floor(square / 9);
const inside = (x, y) => x >= 0 && x < 9 && y >= 0 && y < 10;
const inPalace = (x, y, side) => x >= 3 && x <= 5 && (side === 'red' ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
const riverCrossed = (y, side) => side === 'red' ? y <= 4 : y >= 5;
const identity = piece => ({ side: piece.side, type: piece.type });
const clonePool = pool => ({ red: { ...(pool?.red || {}) }, black: { ...(pool?.black || {}) } });

function drawLimit(value, fallback, minimum = 1) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum) throw new Error('Invalid draw limit');
  return value;
}

/** Same observable position: no piece IDs, hidden identities, or move counters.
 * The remaining public identity pool matters for covered-chess probabilities.
 */
export function positionKey(state) {
  const board = state.board.map(piece => piece
    ? `${piece.side[0]}${piece.type}${piece.covered ? '?' : '!'}` : '.').join('');
  const pool = SIDES.flatMap(side => Object.keys(NON_KING_COUNTS)
    .map(type => state.remainingPool?.[side]?.[type] || 0)).join(',');
  return `${state.variant}|${state.turn}|${state.rules?.jieqiCheckRule || 'public-check'}|${board}|${pool}`;
}

function randomSource(seed) {
  if (seed === undefined) return Math.random;
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value >>>= 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame({ variant = 'standard', seed, rules = {} } = {}) {
  if (!['standard', 'jieqi'].includes(variant)) throw new Error('Unsupported variant');
  const jieqiCheckRule = rules.jieqiCheckRule || 'public-check';
  if (!['public-check', 'capture-only'].includes(jieqiCheckRule)) throw new Error('Unsupported check rule');
  const board = Array(90).fill(null);
  const backRank = ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'];
  const put = (x, y, side, type) => { board[y * 9 + x] = { id: `piece-${y * 9 + x}`, side, type, covered: false }; };
  for (const side of SIDES) {
    const rank = side === 'red' ? 9 : 0;
    backRank.forEach((type, x) => put(x, rank, side, type));
    for (const x of [1, 7]) put(x, side === 'red' ? 7 : 2, side, 'c');
    for (const x of [0, 2, 4, 6, 8]) put(x, side === 'red' ? 6 : 3, side, 'p');
  }
  const remainingPool = { red: {}, black: {} };
  if (variant === 'jieqi') {
    const pool = board.filter(p => p && p.type !== 'k').map(identity);
    const random = randomSource(seed);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let cursor = 0;
    for (const piece of board) {
      if (piece && piece.type !== 'k') {
        piece.covered = true;
        piece.hidden = pool[cursor++];
      }
    }
    for (const side of SIDES) remainingPool[side] = { ...NON_KING_COUNTS };
  }
  const state = { board, turn: 'red', variant, ply: 0, noProgressPly: 0, history: [], remainingPool,
    // Local finite-game conventions, not full tournament long-check/chase adjudication.
    rules: { jieqiCheckRule, repetitionCount: drawLimit(rules.repetitionCount, 3, 2),
      noProgressLimit: drawLimit(rules.noProgressLimit, 120), maxPly: drawLimit(rules.maxPly, 400) },
    result: { ...PLAYING } };
  state.positionCounts = { [positionKey(state)]: 1 };
  return state;
}

function publicPiece(piece) {
  if (!piece) return null;
  return { id: piece.id, side: piece.side, type: piece.type, covered: Boolean(piece.covered) };
}

/** Whitelist public fields; no seed, permutation, or hidden identity escapes. */
export function publicState(state) {
  return {
    board: state.board.map(publicPiece), turn: state.turn, variant: state.variant,
    ply: state.ply, noProgressPly: state.noProgressPly || 0,
    positionCounts: { ...(state.positionCounts || {}) },
    rules: { ...state.rules }, remainingPool: clonePool(state.remainingPool),
    result: { ...(state.result || PLAYING) },
    history: (state.history || []).map(entry => ({
      ply: entry.ply, side: entry.side, move: { ...entry.move },
      piece: publicPiece(entry.piece),
      captured: entry.captured ? { ...publicPiece(entry.captured), wasCovered: Boolean(entry.captured.wasCovered) } : null,
      revealed: entry.revealed ? identity(entry.revealed) : null,
    })),
  };
}

export const observation = (state, _side) => publicState(state);

function piecesBetween(board, from, to) {
  const fx = xOf(from), fy = yOf(from), tx = xOf(to), ty = yOf(to);
  if (fx !== tx && fy !== ty) return Infinity;
  const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
  let count = 0;
  for (let x = fx + dx, y = fy + dy; x !== tx || y !== ty; x += dx, y += dy) {
    if (board[y * 9 + x]) count++;
  }
  return count;
}

/** Piece geometry against a target; always reads visible placeholder identity. */
function canReach(state, from, to) {
  if (from === to || to < 0 || to >= 90) return false;
  const piece = state.board[from];
  if (!piece) return false;
  const target = state.board[to];
  if (target?.side === piece.side) return false;
  const fx = xOf(from), fy = yOf(from), tx = xOf(to), ty = yOf(to);
  const dx = tx - fx, dy = ty - fy, ax = Math.abs(dx), ay = Math.abs(dy);
  const revealedVariant = state.variant === 'jieqi' && !piece.covered;
  switch (piece.type) {
    case 'r': return (dx === 0 || dy === 0) && piecesBetween(state.board, from, to) === 0;
    case 'c': return (dx === 0 || dy === 0) && piecesBetween(state.board, from, to) === (target ? 1 : 0);
    case 'n': {
      if (!((ax === 2 && ay === 1) || (ax === 1 && ay === 2))) return false;
      const leg = ax === 2 ? fy * 9 + fx + Math.sign(dx) : (fy + Math.sign(dy)) * 9 + fx;
      return !state.board[leg];
    }
    case 'b':
      return ax === 2 && ay === 2 && !state.board[(fy + dy / 2) * 9 + fx + dx / 2]
        && (revealedVariant || (piece.side === 'red' ? ty >= 5 : ty <= 4));
    case 'a': return ax === 1 && ay === 1 && (revealedVariant || inPalace(tx, ty, piece.side));
    case 'k':
      if (target?.type === 'k' && !target.covered && dx === 0 && piecesBetween(state.board, from, to) === 0) return true;
      return ax + ay === 1 && inPalace(tx, ty, piece.side);
    case 'p':
      return (dx === 0 && dy === (piece.side === 'red' ? -1 : 1))
        || (dy === 0 && ax === 1 && riverCrossed(fy, piece.side));
    default: return false;
  }
}

function kingSquare(state, side) {
  return state.board.findIndex(p => p && p.side === side && p.type === 'k' && !p.covered);
}

export function inCheck(state, side) {
  const king = kingSquare(state, side);
  if (king < 0) return true;
  for (let from = 0; from < 90; from++) {
    if (state.board[from]?.side === otherSide(side) && canReach(state, from, king)) return true;
  }
  return false;
}

function candidateSquares(state, from) {
  const piece = state.board[from], x = xOf(from), y = yOf(from);
  const targets = [];
  const add = (dx, dy) => { if (inside(x + dx, y + dy)) targets.push((y + dy) * 9 + x + dx); };
  switch (piece.type) {
    case 'r': case 'c':
      for (const [dx, dy] of ORTHOGONAL) {
        let screen = false;
        for (let tx = x + dx, ty = y + dy; inside(tx, ty); tx += dx, ty += dy) {
          const to = ty * 9 + tx;
          if (!state.board[to]) { if (!screen) targets.push(to); continue; }
          if (piece.type === 'r' || screen) { targets.push(to); break; }
          screen = true;
        }
      }
      break;
    case 'n': for (const [dx, dy] of HORSE) add(dx, dy); break;
    case 'b': for (const [dx, dy] of DIAGONAL) add(dx * 2, dy * 2); break;
    case 'a': for (const [dx, dy] of DIAGONAL) add(dx, dy); break;
    case 'k': {
      for (const [dx, dy] of ORTHOGONAL) add(dx, dy);
      const opposingKing = kingSquare(state, otherSide(piece.side));
      if (opposingKing >= 0 && !targets.includes(opposingKing)) targets.push(opposingKing);
      break;
    }
    case 'p': add(0, piece.side === 'red' ? -1 : 1); if (riverCrossed(y, piece.side)) { add(1, 0); add(-1, 0); } break;
  }
  return targets;
}

export function legalMoves(state) {
  if (state.result?.status === 'ended') return [];
  if (kingSquare(state, state.turn) < 0 || kingSquare(state, otherSide(state.turn)) < 0) return [];
  const moves = [];
  for (let from = 0; from < 90; from++) {
    const piece = state.board[from];
    if (piece?.side !== state.turn) continue;
    for (const to of candidateSquares(state, from)) {
      if (!canReach(state, from, to)) continue;
      // Taking a general ends mixed covered chess immediately, even after a
      // previous random reveal left both generals attacked.
      if (state.variant === 'jieqi' && state.board[to]?.type === 'k' && !state.board[to].covered) {
        moves.push({ from, to });
        continue;
      }
      if (state.variant === 'jieqi' && state.rules?.jieqiCheckRule === 'capture-only') {
        moves.push({ from, to });
        continue;
      }
      const board = [...state.board];
      board[to] = piece;
      board[from] = null;
      if (!inCheck({ ...state, board }, state.turn)) moves.push({ from, to });
    }
  }
  return moves;
}

function revealIdentity(piece, supplied, pool, label) {
  const value = supplied || piece.hidden;
  if (!value || !SIDES.includes(value.side) || !Object.hasOwn(NON_KING_COUNTS, value.type)) {
    throw new Error(`${label} requires an identity from the remaining hidden pool`);
  }
  if (piece.hidden && (value.side !== piece.hidden.side || value.type !== piece.hidden.type)) {
    throw new Error(`${label} cannot override a real hidden identity`);
  }
  if (!(pool[value.side][value.type] > 0)) throw new Error(`${label} identity is exhausted`);
  pool[value.side][value.type]--;
  return identity(value);
}

export function result(state) {
  if (state.result?.status === 'ended') return { ...state.result };
  for (const side of SIDES) {
    if (kingSquare(state, side) < 0) return { status: 'ended', winner: otherSide(side), reason: 'general-captured' };
  }
  if (legalMoves(state).length === 0) {
    return { status: 'ended', winner: otherSide(state.turn),
      reason: state.variant === 'standard' ? (inCheck(state, state.turn) ? 'checkmate' : 'stalemate') : 'no-legal-moves' };
  }
  // Wins take precedence when the last move also reaches a draw threshold.
  if ((state.positionCounts?.[positionKey(state)] || 0) >= (state.rules?.repetitionCount || 3)) {
    return { status: 'ended', winner: null, reason: 'threefold-repetition' };
  }
  if ((state.noProgressPly || 0) >= (state.rules?.noProgressLimit || 120)) {
    return { status: 'ended', winner: null, reason: 'no-progress' };
  }
  if ((state.ply || 0) >= (state.rules?.maxPly || 400)) {
    return { status: 'ended', winner: null, reason: 'move-limit' };
  }
  return { ...PLAYING };
}

/** Both optional reveals support probability search over a public observation.
 * A real game's existing hidden values cannot be overwritten by these options.
 */
export function applyMove(state, move, { reveal, captureReveal, capturedReveal } = {}) {
  if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to)
      || !legalMoves(state).some(m => m.from === move.from && m.to === move.to)) throw new Error('Illegal move');
  const before = state.board[move.from];
  const target = state.board[move.to];
  const remainingPool = clonePool(state.remainingPool);
  let captured = target ? { ...publicPiece(target), wasCovered: Boolean(target.covered) } : null;
  if (target?.covered) {
    const value = revealIdentity(target, captureReveal || capturedReveal, remainingPool, 'captureReveal');
    captured = { id: target.id, ...value, covered: false, wasCovered: true };
  }
  let moved = { ...publicPiece(before) }, revealed = null;
  if (before.covered) {
    revealed = revealIdentity(before, reveal, remainingPool, 'reveal');
    moved = { id: before.id, ...revealed, covered: false };
  }
  const board = [...state.board];
  board[move.from] = null;
  board[move.to] = moved;
  const ply = (state.ply || 0) + 1;
  const positionCounts = { ...(state.positionCounts || {}) };
  const beforeKey = positionKey(state);
  if (!positionCounts[beforeKey]) positionCounts[beforeKey] = 1;
  const next = { ...state, board, turn: otherSide(state.turn), ply, remainingPool, positionCounts,
    noProgressPly: target || before.covered ? 0 : (state.noProgressPly || 0) + 1,
    history: [...(state.history || []), { ply, side: state.turn, move: { from: move.from, to: move.to },
      piece: publicPiece(before), captured, revealed }], result: { ...PLAYING } };
  const nextKey = positionKey(next);
  positionCounts[nextKey] = (positionCounts[nextKey] || 0) + 1;
  next.result = result(next);
  return next;
}

/** Standard engine protocol only: mixed covered rules are not a FEN variant. */
export function toFen(state) {
  if (state.variant !== 'standard' || state.board.some(p => p?.covered)) {
    throw new Error('Only standard Xiangqi can be sent to the standard Pikafish engine');
  }
  const ranks = [];
  for (let y = 0; y < 10; y++) {
    let rank = '', empty = 0;
    for (let x = 0; x < 9; x++) {
      const piece = state.board[y * 9 + x];
      if (!piece) { empty++; continue; }
      if (empty) { rank += empty; empty = 0; }
      rank += piece.side === 'red' ? piece.type.toUpperCase() : piece.type;
    }
    if (empty) rank += empty;
    ranks.push(rank);
  }
  return `${ranks.join('/')} ${state.turn === 'red' ? 'w' : 'b'} - - 0 ${Math.floor((state.ply || 0) / 2) + 1}`;
}
