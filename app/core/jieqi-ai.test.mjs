import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, publicState, legalMoves } from './rules.mjs';
import { chooseMove, DIFFICULTY_BUDGETS } from './jieqi-ai.mjs';

const fixedSearch = { difficulty: 'hard', seed: 13579, maxIterations: 350, timeMs: 60000 };
const piece = (side, type, square, covered = false) => ({ id: `test-${square}`, side, type, covered });

function sparse(entries, pool = {}) {
  const state = createGame({ variant: 'jieqi', seed: 1 });
  state.board = Array(90).fill(null);
  for (const [square, side, type, covered = false] of entries) state.board[square] = piece(side, type, square, covered);
  state.remainingPool = { red: {}, black: {}, ...pool };
  return state;
}

test('equivalent public observations give identical decisions despite different actual arrangements', () => {
  const first = createGame({ variant: 'jieqi', seed: 'permutation-one' });
  const second = createGame({ variant: 'jieqi', seed: 'permutation-two' });
  assert.notDeepEqual(first.board, second.board);
  assert.deepEqual(publicState(first), publicState(second));
  const before = structuredClone(first);
  const a = chooseMove(first, { ...fixedSearch, maxIterations: 140 });
  const b = chooseMove(second, { ...fixedSearch, maxIterations: 140 });
  assert.deepEqual(a.move, b.move);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.stats.candidates, b.stats.candidates);
  assert.equal(a.stats.iterations, 140);
  assert.ok(a.stats.chanceSamples > 0);
  assert.deepEqual(first, before, 'search must not mutate the real game');
});

test('search does not read concealed identity properties', () => {
  const state = createGame({ variant: 'jieqi', seed: 3 });
  for (const value of state.board.filter(value => value?.covered)) {
    Object.defineProperty(value, 'hidden', { get() { throw new Error('Secret information was read'); } });
  }
  const found = chooseMove(state, { ...fixedSearch, maxIterations: 50 });
  assert.ok(legalMoves(state).some(move => move.from === found.move.from && move.to === found.move.to));
});

test('takes a visible general immediately', () => {
  const state = sparse([[85, 'red', 'k'], [4, 'black', 'k'], [49, 'red', 'p'], [13, 'red', 'r']]);
  const answer = chooseMove(state, fixedSearch);
  assert.deepEqual(answer.move, { from: 13, to: 4 });
  assert.equal(answer.stats.immediateWin, true);
  assert.equal(answer.score, 1);
});

test('takes a free exposed rook', () => {
  const state = sparse([[85, 'red', 'k'], [4, 'black', 'k'], [49, 'red', 'p'], [63, 'red', 'r'], [54, 'black', 'r']]);
  const answer = chooseMove(state, fixedSearch);
  assert.deepEqual(answer.move, { from: 63, to: 54 });
});

test('accounts for a covered piece revealing as an enemy and immediately losing the general', () => {
  const state = sparse([[85, 'red', 'k'], [3, 'black', 'k'], [76, 'red', 'p', true]], { red: {}, black: { r: 1 } });
  const answer = chooseMove(state, fixedSearch);
  assert.notDeepEqual(answer.move, { from: 76, to: 67 });
  assert.ok(legalMoves(state).some(move => move.from === answer.move.from && move.to === answer.move.to));
  const risky = answer.stats.candidates.find(entry => entry.move.from === 76 && entry.move.to === 67);
  assert.ok(risky);
  assert.equal(risky.score, -1);
});

test('simulates a covered capture and a moving reveal from one pool without replacement', () => {
  const state = sparse([[85, 'red', 'k'], [4, 'black', 'k'], [49, 'red', 'p'], [63, 'red', 'r', true], [54, 'black', 'p', true]],
    { red: { r: 1 }, black: { p: 1 } });
  const answer = chooseMove(state, { ...fixedSearch, maxIterations: 100 });
  assert.ok(answer.move);
  assert.ok(answer.stats.chanceSamples > 0);
  assert.equal(state.remainingPool.red.r, 1);
  assert.equal(state.remainingPool.black.p, 1);
});

test('difficulty budgets and explicit cancellation are available', () => {
  assert.deepEqual(DIFFICULTY_BUDGETS, { easy: 150, medium: 600, hard: 1800 });
  const controller = new AbortController();
  controller.abort();
  const answer = chooseMove(createGame({ variant: 'jieqi' }), { signal: controller.signal });
  assert.equal(answer.move, null);
  assert.equal(answer.stats.cancelled, true);
  assert.equal(answer.stats.iterations, 0);
});

test('a short wall-clock budget produces a legal action', () => {
  const state = publicState(createGame({ variant: 'jieqi', seed: 5 }));
  const answer = chooseMove(state, { timeMs: 30, seed: 2 });
  assert.equal(answer.stats.budgetMs, 30);
  assert.ok(answer.stats.elapsedMs < 1500, `search took ${answer.stats.elapsedMs} ms`);
  assert.ok(legalMoves(state).some(move => move.from === answer.move.from && move.to === answer.move.to));
});

test('unknown and prototype-named difficulties fall back to a finite medium budget', () => {
  const state = publicState(createGame({ variant: 'jieqi', seed: 5 }));
  for (const difficulty of ['toString', '__proto__', 'constructor', 'unknown']) {
    const answer = chooseMove(state, { difficulty, maxIterations: 0 });
    assert.equal(answer.stats.difficulty, 'medium');
    assert.equal(answer.stats.budgetMs, 600);
    assert.ok(answer.move);
  }
});
