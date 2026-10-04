import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, applyMove, publicState, positionKey, toFen, inCheck, result } from './rules.mjs';

const sq = (x, y) => y * 9 + x;
const p = (side, type, extra = {}) => ({ side, type, covered: false, ...extra });
const has = (state, from, to) => legalMoves(state).some(m => m.from === from && m.to === to);
function sparse(pieces, { variant = 'standard', turn = 'red', rules = {} } = {}) {
  const state = createGame({ variant, seed: 'rules-tests', rules });
  state.board = Array(90).fill(null);
  state.turn = turn;
  for (const [square, piece] of pieces) state.board[square] = { id: `test-${square}`, ...piece };
  return state;
}
function position(pieces, options = {}) {
  return sparse([[sq(4, 9), p('red', 'k')], [sq(3, 0), p('black', 'k')], ...pieces], options);
}

test('standard initial legal move counts match independent Pikafish perft 44 / 1920', () => {
  const state = createGame();
  const moves = legalMoves(state);
  assert.equal(moves.length, 44);
  assert.equal(moves.reduce((total, move) => total + legalMoves(applyMove(state, move)).length, 0), 1920);
  assert.equal(toFen(state), 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
});

test('ordinary moves are immutable and update turn and history', () => {
  const state = createGame();
  const original = JSON.stringify(state);
  const next = applyMove(state, { from: sq(0, 6), to: sq(0, 5) });
  assert.equal(JSON.stringify(state), original);
  assert.equal(next.board[sq(0, 6)], null);
  assert.equal(next.board[sq(0, 5)].type, 'p');
  assert.equal(next.turn, 'black');
  assert.equal(next.ply, 1);
  assert.equal(next.history.length, 1);
  assert.equal(next.result.status, 'playing');
  assert.throws(() => applyMove(state, { from: sq(0, 6), to: sq(0, 4) }), /Illegal/);
});

test('cannons require exactly one screen to capture, rooks require none', () => {
  const base = [[sq(0, 5), p('red', 'c')], [sq(0, 1), p('black', 'r')]];
  assert.equal(has(position(base), sq(0, 5), sq(0, 1)), false);
  const one = position([...base, [sq(0, 3), p('red', 'p')]]);
  assert.equal(has(one, sq(0, 5), sq(0, 1)), true);
  assert.equal(has(one, sq(0, 5), sq(0, 4)), true);
  assert.equal(has(one, sq(0, 5), sq(0, 2)), false);
  assert.equal(has(position([...base, [sq(0, 3), p('red', 'p')], [sq(0, 2), p('black', 'p')]]), sq(0, 5), sq(0, 1)), false);
  const rook = position([[sq(0, 5), p('red', 'r')], [sq(0, 1), p('black', 'r')]]);
  assert.equal(has(rook, sq(0, 5), sq(0, 1)), true);
  rook.board[sq(0, 3)] = p('red', 'p');
  assert.equal(has(rook, sq(0, 5), sq(0, 1)), false);
});

test('horse legs and elephant eyes block moves', () => {
  const horse = position([[sq(1, 7), p('red', 'n')]]);
  assert.equal(has(horse, sq(1, 7), sq(2, 5)), true);
  horse.board[sq(1, 6)] = p('red', 'p');
  assert.equal(has(horse, sq(1, 7), sq(2, 5)), false);
  const elephant = position([[sq(4, 7), p('red', 'b')]]);
  assert.equal(has(elephant, sq(4, 7), sq(2, 5)), true);
  elephant.board[sq(3, 6)] = p('red', 'p');
  assert.equal(has(elephant, sq(4, 7), sq(2, 5)), false);
});

test('standard palace/river rules and expanded revealed jieqi advisor/elephant rules', () => {
  const elephant = position([[sq(4, 5), p('red', 'b')]]);
  assert.equal(has(elephant, sq(4, 5), sq(2, 3)), false);
  const variantElephant = position([[sq(4, 5), p('red', 'b')]], { variant: 'jieqi' });
  assert.equal(has(variantElephant, sq(4, 5), sq(2, 3)), true);
  variantElephant.board[sq(3, 4)] = p('black', 'p');
  assert.equal(has(variantElephant, sq(4, 5), sq(2, 3)), false);
  const advisor = position([[sq(4, 5), p('red', 'a')]]);
  assert.equal(has(advisor, sq(4, 5), sq(5, 4)), false);
  advisor.variant = 'jieqi';
  assert.equal(has(advisor, sq(4, 5), sq(5, 4)), true);
  advisor.board[sq(4, 5)].covered = true;
  assert.equal(has(advisor, sq(4, 5), sq(5, 4)), false);
  const palace = position([[sq(4, 8), p('red', 'a')]]);
  assert.equal(has(palace, sq(4, 8), sq(3, 7)), true);
  palace.board[sq(4, 7)] = palace.board[sq(4, 8)];
  palace.board[sq(4, 8)] = null;
  assert.equal(has(palace, sq(4, 7), sq(3, 6)), false);
  const king = sparse([[sq(3, 8), p('red', 'k')], [sq(4, 0), p('black', 'k')]]);
  assert.equal(has(king, sq(3, 8), sq(2, 8)), false);
  assert.equal(has(king, sq(3, 8), sq(3, 7)), true);
});

test('pawns advance forward, gain sideways moves across river, never retreat', () => {
  const state = position([[sq(0, 5), p('red', 'p')], [sq(8, 4), p('black', 'p')]]);
  assert.equal(has(state, sq(0, 5), sq(0, 4)), true);
  assert.equal(has(state, sq(0, 5), sq(1, 5)), false);
  const crossed = applyMove(state, { from: sq(0, 5), to: sq(0, 4) });
  crossed.turn = 'red';
  assert.equal(has(crossed, sq(0, 4), sq(1, 4)), true);
  assert.equal(has(crossed, sq(0, 4), sq(0, 5)), false);
  state.turn = 'black';
  assert.equal(has(state, sq(8, 4), sq(8, 5)), true);
  assert.equal(has(state, sq(8, 4), sq(7, 4)), false);
});

test('facing generals and a pinned blocker are handled without hidden identities', () => {
  const state = sparse([[sq(4, 9), p('red', 'k')], [sq(4, 0), p('black', 'k')], [sq(4, 5), p('red', 'r')]]);
  assert.equal(inCheck(state, 'red'), false);
  assert.equal(has(state, sq(4, 5), sq(0, 5)), false);
  assert.equal(has(state, sq(4, 5), sq(4, 4)), true);
  state.board[sq(4, 5)] = null;
  assert.equal(inCheck(state, 'red'), true);
  assert.equal(inCheck(state, 'black'), true);
  assert.equal(has(state, sq(4, 9), sq(4, 0)), true);
});

test('mixed setup preserves two exposed generals and shuffles all thirty other identities', () => {
  const state = createGame({ variant: 'jieqi', seed: 7 });
  assert.equal(state.board.filter(p => p?.covered).length, 30);
  assert.equal(state.board.filter(p => p && !p.covered).length, 2);
  const counts = { red: {}, black: {} };
  for (const piece of state.board.filter(p => p?.covered)) {
    counts[piece.hidden.side][piece.hidden.type] = (counts[piece.hidden.side][piece.hidden.type] || 0) + 1;
  }
  assert.deepEqual(counts, state.remainingPool);
  assert(state.board.some(p => p?.covered && p.side !== p.hidden.side));
  assert.deepEqual(state, createGame({ variant: 'jieqi', seed: 7 }));
});

test('public observations and legal moves cannot reveal a hidden permutation', () => {
  const first = createGame({ variant: 'jieqi', seed: 'one' });
  const second = createGame({ variant: 'jieqi', seed: 'two' });
  assert.notDeepEqual(first.board, second.board);
  assert.deepEqual(publicState(first), publicState(second));
  assert.deepEqual(legalMoves(first), legalMoves(second));
  assert.equal(JSON.stringify(publicState(first)).includes('hidden'), false);
  const move = legalMoves(first).find(m => first.board[m.from].covered && !first.board[m.to]);
  assert.throws(() => applyMove(publicState(first), move), /requires an identity/);
  assert.throws(() => toFen(first), /Only standard/);
});

test('covered first move follows slot role, then may reveal the opposite side', () => {
  const from = sq(0, 6), to = sq(0, 5);
  const state = position([[from, p('red', 'p', { covered: true, hidden: { side: 'black', type: 'n' } })]], { variant: 'jieqi' });
  const original = JSON.stringify(state);
  assert.equal(has(state, from, to), true);
  assert.equal(has(state, from, sq(1, 4)), false);
  const next = applyMove(state, { from, to });
  assert.equal(JSON.stringify(state), original);
  assert.deepEqual(next.board[to], { id: `test-${from}`, side: 'black', type: 'n', covered: false });
  assert.equal(next.turn, 'black');
  assert.equal(next.remainingPool.black.n, 1);
  assert.deepEqual(next.history[0].revealed, { side: 'black', type: 'n' });
});

test('blind capture removes and publicly identifies even a true friendly piece', () => {
  const from = sq(0, 5), to = sq(0, 3);
  const state = position([[from, p('red', 'r')], [to, p('black', 'p', { covered: true, hidden: { side: 'red', type: 'c' } })]], { variant: 'jieqi' });
  const next = applyMove(state, { from, to });
  assert.equal(next.board[to].type, 'r');
  assert.deepEqual(next.history[0].captured, { id: `test-${to}`, side: 'red', type: 'c', covered: false, wasCovered: true });
  assert.equal(next.remainingPool.red.c, 1);
  assert.equal(publicState(next).history[0].captured.side, 'red');
});

test('public probability simulation handles two reveals without replacement', () => {
  const from = sq(0, 5), to = sq(0, 3);
  const state = publicState(position([[from, p('red', 'r', { covered: true })], [to, p('black', 'p', { covered: true })]], { variant: 'jieqi' }));
  const outcome = { side: 'black', type: 'n' };
  const next = applyMove(state, { from, to }, { captureReveal: outcome, reveal: outcome });
  assert.equal(next.remainingPool.black.n, 0);
  assert.equal(state.remainingPool.black.n, 2);
  state.remainingPool.black.n = 1;
  assert.throws(() => applyMove(state, { from, to }, { captureReveal: outcome, reveal: outcome }), /exhausted/);
  assert.equal(state.remainingPool.black.n, 1);
});

test('real hidden identities cannot be overridden by probability-search options', () => {
  const state = position([[sq(0, 6), p('red', 'p', { covered: true, hidden: { side: 'black', type: 'r' } })]], { variant: 'jieqi' });
  assert.throws(() => applyMove(state, { from: sq(0, 6), to: sq(0, 5) }, { reveal: { side: 'red', type: 'r' } }), /cannot override/);
});

test('opposite-color reveal may expose own general; next player can capture it', () => {
  const from = sq(4, 8), to = sq(4, 7);
  const state = position([[from, p('red', 'r', { covered: true, hidden: { side: 'black', type: 'r' } })]], { variant: 'jieqi' });
  assert.equal(has(state, from, to), true);
  const next = applyMove(state, { from, to });
  assert.equal(inCheck(next, 'red'), true);
  assert.equal(next.result.status, 'playing');
  const won = applyMove(next, { from: to, to: sq(4, 9) });
  assert.deepEqual(won.result, { status: 'ended', winner: 'black', reason: 'general-captured' });
  assert.deepEqual(legalMoves(won), []);
});

test('public-check requires responding to visible check; configurable capture-only does not', () => {
  const pieces = [[sq(0, 9), p('black', 'r')], [sq(4, 8), p('red', 'r', { covered: true, hidden: { side: 'black', type: 'n' } })]];
  const state = position(pieces, { variant: 'jieqi' });
  assert.equal(inCheck(state, 'red'), true);
  assert.equal(has(state, sq(4, 8), sq(4, 7)), false);
  state.rules.jieqiCheckRule = 'capture-only';
  assert.equal(has(state, sq(4, 8), sq(4, 7)), true);
});

test('standard checkmate and stalemate both award a win to the opponent', () => {
  const mate = position([[sq(0, 9), p('black', 'r')], [sq(1, 8), p('black', 'r')]]);
  assert.deepEqual(result(mate), { status: 'ended', winner: 'black', reason: 'checkmate' });
  const stalemate = sparse([[sq(4, 9), p('red', 'k')], [sq(4, 0), p('black', 'k')],
    [sq(3, 8), p('black', 'r')], [sq(5, 8), p('black', 'r')], [sq(4, 5), p('black', 'p')]]);
  assert.equal(inCheck(stalemate, 'red'), false);
  assert.deepEqual(result(stalemate), { status: 'ended', winner: 'black', reason: 'stalemate' });
});

test('standard and covered games stop at the third occurrence of the same public position', () => {
  const cycle = [
    { from: sq(1, 9), to: sq(0, 7) }, { from: sq(1, 0), to: sq(0, 2) },
    { from: sq(0, 7), to: sq(1, 9) }, { from: sq(0, 2), to: sq(1, 0) },
  ];
  for (const variant of ['standard', 'jieqi']) {
    let state = variant === 'standard' ? createGame() : position(
      [[sq(1, 9), p('red', 'n')], [sq(1, 0), p('black', 'n')]], { variant });
    const original = JSON.stringify(state);
    const initialKey = positionKey(state);
    for (const move of cycle) state = applyMove(state, move);
    assert.equal(state.result.status, 'playing');
    assert.equal(state.positionCounts[initialKey], 2);
    for (const move of cycle) state = applyMove(state, move);
    assert.deepEqual(state.result, { status: 'ended', winner: null, reason: 'threefold-repetition' });
    assert.equal(state.positionCounts[initialKey], 3);
    assert.equal(publicState(state).positionCounts[initialKey], 3);
    assert.deepEqual(legalMoves(state), []);
    assert.throws(() => applyMove(state, cycle[0]), /Illegal/);
    assert.equal(JSON.parse(original).history.length, 0);
  }
});

test('repetition keys exclude hidden identities and IDs, but retain public turn and covered state', () => {
  const first = createGame({ variant: 'jieqi', seed: 1 });
  const second = createGame({ variant: 'jieqi', seed: 2 });
  assert.equal(positionKey(first), positionKey(second));
  const unknown = second.board.find(piece => piece?.covered);
  unknown.id = 'unrelated-slot-id';
  Object.defineProperty(unknown, 'hidden', { get() { throw new Error('Secret was accessed'); } });
  assert.equal(positionKey(first), positionKey(second));
  assert.deepEqual(first.positionCounts, publicState(second).positionCounts);
  second.turn = 'black';
  assert.notEqual(positionKey(first), positionKey(second));
  second.turn = 'red';
  unknown.covered = false;
  assert.notEqual(positionKey(first), positionKey(second));
});

test('120 quiet half moves draw; a capture or a new reveal resets progress', () => {
  for (const variant of ['standard', 'jieqi']) {
    const quiet = position([[sq(1, 9), p('red', 'n')]], { variant });
    quiet.noProgressPly = 119;
    const drawn = applyMove(quiet, { from: sq(1, 9), to: sq(0, 7) });
    assert.equal(drawn.noProgressPly, 120);
    assert.equal(publicState(drawn).noProgressPly, 120);
    assert.deepEqual(drawn.result, { status: 'ended', winner: null, reason: 'no-progress' });
    assert.equal(quiet.noProgressPly, 119);

    const capture = position([[sq(0, 5), p('red', 'r')], [sq(0, 3), p('black', 'p')]], { variant });
    capture.noProgressPly = 119;
    const progressed = applyMove(capture, { from: sq(0, 5), to: sq(0, 3) });
    assert.equal(progressed.noProgressPly, 0);
    assert.equal(progressed.result.status, 'playing');
  }
  const covered = position([[sq(0, 6), p('red', 'p', { covered: true, hidden: { side: 'black', type: 'n' } })]], { variant: 'jieqi' });
  covered.noProgressPly = 119;
  const revealed = applyMove(covered, { from: sq(0, 6), to: sq(0, 5) });
  assert.equal(revealed.noProgressPly, 0);
  assert.equal(revealed.result.status, 'playing');
});

test('400 half moves bound a game even while captures or reveals reset progress', () => {
  for (const variant of ['standard', 'jieqi']) {
    const state = position([[sq(0, 5), p('red', 'r')], [sq(0, 3), p('black', 'p')]], { variant });
    state.ply = 399;
    const next = applyMove(state, { from: sq(0, 5), to: sq(0, 3) });
    assert.equal(next.noProgressPly, 0);
    assert.deepEqual(next.result, { status: 'ended', winner: null, reason: 'move-limit' });
  }
});

test('a decisive win takes precedence over simultaneous local draw limits', () => {
  const state = sparse([[sq(4, 9), p('red', 'k')], [sq(4, 0), p('black', 'k')],
    [sq(0, 1), p('red', 'r')], [sq(1, 2), p('red', 'r')], [sq(4, 4), p('red', 'p')]]);
  state.ply = 399;
  state.noProgressPly = 119;
  const next = applyMove(state, { from: sq(1, 2), to: sq(1, 0) });
  assert.deepEqual(next.result, { status: 'ended', winner: 'red', reason: 'checkmate' });
});

test('public simulations retain the same repetition history and draw conventions', () => {
  const state = createGame({ variant: 'jieqi', seed: 21, rules: { noProgressLimit: 80, maxPly: 250 } });
  const move = legalMoves(state).find(move => state.board[move.from].covered && !state.board[move.to]);
  const sampledIdentity = { ...state.board[move.from].hidden };
  const real = applyMove(state, move);
  const simulated = applyMove(publicState(state), move, { reveal: sampledIdentity });
  assert.deepEqual(publicState(real), publicState(simulated));
  assert.equal(simulated.rules.noProgressLimit, 80);
  assert.equal(simulated.rules.maxPly, 250);
  assert.equal(simulated.rules.repetitionCount, 3);
  assert.throws(() => createGame({ rules: { maxPly: 0 } }), /Invalid draw limit/);
});
