import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createPositionAnalysis, normalizeStandard, normalizeJieqi } from './analysis.mjs';

function state(ply = 0, { branch = false, ended = false, winner = null } = {}) {
  return {
    variant: 'standard', ply, turn: ply % 2 ? 'black' : 'red',
    history: Array.from({ length: ply }, (_, i) => ({ move: { from: 64 - i, to: (branch && i === 1 ? 47 : 55) - i } })),
    result: ended ? { status: 'ended', winner } : { status: 'playing', winner: null },
  };
}

function report(depth = 10, { win = 100, draw = 700, loss = 200, score = 35 } = {}) {
  return { depth, wdl: { win, draw, loss, scale: 1000, perspective: 'sideToMove' },
    score: { type: 'cp', value: score, perspective: 'sideToMove' },
    pv: ['b2e2', 'h9g7'], nodes: 12345, timeMs: 1000 };
}

function harness(t) {
  const requests = [];
  const stops = [];
  const api = {
    analysisEvaluate(payload) {
      return new Promise((resolve, reject) => requests.push({ payload, resolve, reject }));
    },
    analysisStop() { stops.push(true); return Promise.resolve({ stopped: true }); },
  };
  const controller = createPositionAnalysis({ api, storage: null,
    formatMove: (snapshot, suggestion) => `${snapshot.ply}:${suggestion}` });
  t.after(() => controller.dispose());
  return { controller, requests, stops };
}

async function until(predicate, description = 'condition') {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await delay(5);
  }
}

test('standard normalization consistently switches black score, bounds and WDL to red perspective', () => {
  const raw = report(15, { win: 600, draw: 300, loss: 100, score: 123 });
  const red = normalizeStandard(raw, state(0));
  assert.deepEqual(red.wdl, { red: 600, draw: 300, black: 100, scale: 1000 });
  assert.equal(red.trend, 75);
  assert.equal(red.score.value, 123);
  const black = normalizeStandard(raw, state(1));
  assert.deepEqual(black.wdl, { red: 100, draw: 300, black: 600, scale: 1000 });
  assert.equal(black.trend, 25);
  assert.equal(black.score.value, -123);
  assert.equal(black.score.perspective, 'red');
  assert.equal(black.suggestion, 'b2e2');
  assert.equal(black.rawScore, raw.score);
  assert.equal(black.rawWdl, raw.wdl);
  const bounded = normalizeStandard({ ...raw, score: { ...raw.score, type: 'mate', value: -3, bound: 'lowerbound' } }, state(1));
  assert.equal(bounded.score.value, 3);
  assert.equal(bounded.score.bound, 'upperbound');
});

test('missing or invalid WDL never becomes a fabricated probability; Jieqi retains distinct heuristic meaning', () => {
  for (const wdl of [null, undefined, { ...report().wdl, win: 101 },
    { ...report().wdl, win: NaN }, { ...report().wdl, scale: 100 },
    { ...report().wdl, perspective: 'red' }]) {
    const result = normalizeStandard({ ...report(), wdl }, state());
    assert.equal(result.wdl, null);
    assert.equal(result.trend, null);
    assert.equal(result.score.value, 35);
  }
  const mixed = normalizeJieqi({ score: 0.4, stats: { iterations: 42, elapsedMs: 700 } }, state(1));
  assert.equal(mixed.wdl, null);
  assert.equal(mixed.advantage, -40);
  assert.equal(mixed.trend, 30);
  assert.equal(normalizeJieqi({ score: NaN }, state()).trend, null);
});

test('menu leave and re-entry reject an old reply and restart analysis of the retained position', async t => {
  const { controller, requests, stops } = harness(t);
  controller.update(state()); controller.setActive(true);
  await until(() => requests.length === 1);
  controller.setActive(false);
  requests[0].resolve(report(99));
  await delay(10);
  assert.equal(controller.getState().history.length, 0);
  assert.equal(controller.getState().busy, false);
  controller.setActive(true);
  await until(() => requests.length === 2);
  requests[1].resolve(report(11));
  await until(() => !controller.getState().busy);
  assert.equal(controller.getState().current.depth, 11);
  assert.ok(stops.length >= 1);
});

test('reset rejects a prior game result even when both games have the same opening path', async t => {
  const { controller, requests } = harness(t);
  controller.update(state()); controller.setActive(true);
  await until(() => requests.length === 1);
  controller.reset(); controller.update(state());
  await until(() => requests.length === 2);
  requests[0].resolve(report(99));
  await delay(10);
  assert.equal(controller.getState().history.length, 0);
  assert.equal(controller.getState().busy, true);
  requests[1].resolve(report(12));
  await until(() => !controller.getState().busy);
  assert.equal(controller.getState().current.depth, 12);
});

test('forward moves preserve a running evaluation then schedule the newest position without starvation', async t => {
  const { controller, requests, stops } = harness(t);
  controller.update(state()); controller.setActive(true);
  await until(() => requests.length === 1);
  controller.update(state(1)); controller.update(state(2)); controller.update(state(3));
  assert.equal(requests.length, 1);
  assert.equal(stops.length, 0);
  requests[0].resolve(report(10));
  await until(() => requests.length === 2);
  assert.equal(controller.getState().history[0].ply, 0);
  assert.equal(requests[1].payload.moves.length, 3);
  assert.equal(requests[1].payload.seconds, 1);
  requests[1].resolve(report(15));
  await until(() => !controller.getState().busy);
  assert.deepEqual(controller.getState().history.map(point => point.ply), [0, 3]);
});

test('undo deletes future records and a branching replay does not accept results for the abandoned path', async t => {
  const { controller, requests } = harness(t);
  controller.update(state(3)); controller.setActive(true);
  controller.ingest(report(10), state(0));
  controller.ingest(report(11), state(1));
  controller.ingest(report(12), state(2));
  controller.ingest(report(13), state(3));
  controller.deep();
  await until(() => requests.length === 1);
  const oldGeneration = controller.getState().generation;
  controller.update(state(1));
  assert.ok(controller.getState().generation > oldGeneration);
  assert.deepEqual(controller.getState().history.map(point => point.ply), [0, 1]);
  controller.update(state(2, { branch: true }));
  controller.ingest(report(99), state(2));
  assert.deepEqual(controller.getState().history.map(point => point.ply), [0, 1]);
  requests[0].resolve(report(99));
  await until(() => requests.length === 2);
  requests[1].resolve(report(14));
  await until(() => !controller.getState().busy);
  assert.deepEqual(controller.getState().history.map(point => point.ply), [0, 1, 2]);
  assert.equal(controller.getState().current.depth, 14);
});

test('playing-engine and late independent reports cannot replace a deeper result with a shallower result', async t => {
  const { controller, requests } = harness(t);
  controller.update(state(1)); controller.setActive(true);
  await until(() => requests.length === 1);
  controller.ingest(report(20, { score: -100 }), state(1));
  controller.ingest(report(5, { score: 900 }), state(1));
  assert.equal(controller.getState().current.depth, 20);
  assert.equal(controller.getState().current.score.value, 100);
  requests[0].resolve(report(15, { score: 200 }));
  await until(() => !controller.getState().busy);
  assert.equal(controller.getState().current.depth, 20);
  assert.equal(controller.getState().current.suggestionText, '1:b2e2');
  controller.ingest(report(25), state(1));
  assert.equal(controller.getState().current.depth, 25);
});

test('actual terminal result overrides same-ply prediction, rejects late searches and can be undone at that same ply', async t => {
  const { controller, requests } = harness(t);
  controller.update(state(1)); controller.setActive(true);
  await until(() => requests.length === 1);
  controller.update(state(1, { ended: true, winner: 'red' }));
  let current = controller.getState().current;
  assert.equal(current.terminal, true);
  assert.deepEqual(current.wdl, { red: 1000, draw: 0, black: 0, scale: 1000 });
  controller.ingest(report(99), state(1));
  requests[0].resolve(report(99));
  await delay(10);
  assert.equal(controller.getState().current.terminal, true);
  controller.update(state(1));
  assert.equal(controller.getState().history.length, 0);
  await until(() => requests.length === 2);
  requests[1].resolve(report(10));
  await until(() => !controller.getState().busy);
  assert.equal(controller.getState().current.terminal, false);
  controller.update(state(1, { ended: true }));
  current = controller.getState().current;
  assert.equal(current.trend, 50);
  assert.deepEqual(current.wdl, { red: 0, draw: 1000, black: 0, scale: 1000 });
});

test('deep analysis cancels a pending ordinary request and only the three-second reply is stored', async t => {
  const { controller, requests } = harness(t);
  controller.update(state()); controller.setActive(true);
  await until(() => requests.length === 1);
  controller.deep();
  await until(() => requests.length === 2);
  assert.equal(requests[1].payload.seconds, 3);
  requests[0].resolve(report(50));
  await delay(10);
  assert.equal(controller.getState().history.length, 0);
  assert.equal(controller.getState().busy, true);
  requests[1].resolve(report(15));
  await until(() => !controller.getState().busy);
  assert.equal(controller.getState().current.depth, 15);
});
