'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { PikafishEngine, validateRequest, validateAnalysisRequest, parsePrincipalVariation } = require('./engine.cjs');

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const INITIAL_LEGAL_MOVES = new Set([
    'a0a1', 'a0a2', 'i0i1', 'i0i2', 'b0a2', 'b0c2', 'h0g2', 'h0i2',
    'c0a2', 'c0e2', 'g0e2', 'g0i2', 'd0e1', 'f0e1', 'e0e1',
    'b2b1', 'b2b3', 'b2b4', 'b2b5', 'b2b6', 'b2b9', 'b2a2', 'b2c2', 'b2d2', 'b2e2', 'b2f2', 'b2g2',
    'h2h1', 'h2h3', 'h2h4', 'h2h5', 'h2h6', 'h2h9', 'h2i2', 'h2g2', 'h2f2', 'h2e2', 'h2d2', 'h2c2',
    'a3a4', 'c3c4', 'e3e4', 'g3g4', 'i3i4',
]);

test('request validation prevents UCI injection and preserves history semantics', () => {
    assert.equal(INITIAL_LEGAL_MOVES.size, 44);
    assert.throws(() => validateRequest({ fen: `${START_FEN}\nquit` }), { code: 'ENGINE_BAD_REQUEST' });
    assert.throws(() => validateRequest({ moves: ['a0a0'] }), { code: 'ENGINE_BAD_REQUEST' });
    assert.throws(() => validateRequest({ moves: Array(2) }), { code: 'ENGINE_BAD_REQUEST' });
    assert.throws(() => validateRequest({ fen: START_FEN.replace('0 1', '0 99999999999999999999') }), { code: 'ENGINE_BAD_REQUEST' });
    assert.throws(() => validateRequest({ difficulty: 'custom', seconds: 31 }), { code: 'ENGINE_BAD_REQUEST' });
    assert.equal(validateRequest({ difficulty: 'custom', seconds: 12 }).command, 'go movetime 12000');
    assert.equal(validateRequest({ moves: ['b2e2'] }).position, 'startpos moves b2e2');
    assert.equal(validateRequest({ fen: START_FEN.replace(' w ', ' r ') }).position, `fen ${START_FEN}`);
});

test('official engine handshakes and returns a legal starting move and search data', { timeout: 25000 }, async t => {
    const engine = new PikafishEngine();
    t.after(() => engine.dispose());
    const info = await engine.engineInfo();
    assert.equal(info.available, true);
    assert.match(info.engine, /Pikafish 2026-09-06/);
    assert.equal(info.threads, 8);
    assert.equal(info.hashMb, 512);
    const result = await engine.engineMove({ fen: START_FEN, difficulty: 'custom', seconds: 1 });
    assert.ok(INITIAL_LEGAL_MOVES.has(result.move), `Unexpected initial move ${result.move}`);
    assert.ok(result.depth > 0);
    assert.ok(result.nodes > 0);
    assert.ok(result.timeMs >= 700 && result.timeMs < 10000);
    assert.ok(['cp', 'mate'].includes(result.score.type));
    assert.equal(result.score.perspective, 'sideToMove');
    assert.equal(info.wdlAvailable, true);
    assert.equal(result.wdl.win + result.wdl.draw + result.wdl.loss, 1000);
    assert.equal(result.wdl.perspective, 'sideToMove');
    assert.equal(result.pv[0], result.move);
});

test('stop retires the old search; a new starting search cannot receive stale black-side results', { timeout: 30000 }, async t => {
    const engine = new PikafishEngine();
    t.after(() => engine.dispose());
    await engine.engineInfo();
    const pending = engine.engineMove({ moves: ['b2e2'], difficulty: 'custom', seconds: 30 });
    const cancellation = assert.rejects(pending, { code: 'ENGINE_CANCELLED' });
    await assert.rejects(engine.engineMove({ difficulty: 'easy' }), { code: 'ENGINE_BUSY' });
    await delay(100);
    assert.deepEqual(engine.engineStop(), { stopped: true });
    const newGame = engine.engineMove({ difficulty: 'easy' });
    await cancellation;
    const result = await newGame;
    assert.ok(INITIAL_LEGAL_MOVES.has(result.move), `Stale or invalid move ${result.move}`);
    assert.deepEqual(engine.engineStop(), { stopped: false });
});

test('stop during initial startup rejects predictably and allows a subsequent game', { timeout: 25000 }, async t => {
    const engine = new PikafishEngine();
    t.after(() => engine.dispose());
    const pending = engine.engineMove({ difficulty: 'expert' });
    const cancellation = assert.rejects(pending, { code: 'ENGINE_CANCELLED' });
    assert.deepEqual(engine.engineStop(), { stopped: true });
    await cancellation;
    const result = await engine.engineMove({ difficulty: 'easy' });
    assert.ok(INITIAL_LEGAL_MOVES.has(result.move));
});

test('engine-side illegal history rejection is reported and the next valid game recovers', { timeout: 25000 }, async t => {
    const engine = new PikafishEngine();
    t.after(() => engine.dispose());
    await assert.rejects(engine.engineMove({ moves: ['a0a9'], difficulty: 'easy' }), { code: 'ENGINE_POSITION_ERROR' });
    const result = await engine.engineMove({ moves: [], difficulty: 'easy' });
    assert.ok(INITIAL_LEGAL_MOVES.has(result.move));
});

test('analysis validates its fixed budgets and keeps the same position/history safeguards', () => {
    assert.equal(validateAnalysisRequest({ moves: ['b2e2'] }).command, 'go movetime 1000');
    assert.equal(validateAnalysisRequest({ seconds: 3 }).command, 'go movetime 3000');
    for (const seconds of [0, 2, 4, '1', null, NaN, Infinity]) {
        assert.throws(() => validateAnalysisRequest({ seconds }), { code: 'ENGINE_BAD_REQUEST' });
    }
    assert.throws(() => validateAnalysisRequest([]), { code: 'ENGINE_BAD_REQUEST' });
    assert.throws(() => validateAnalysisRequest({ moves: ['a0a1\nquit'] }), { code: 'ENGINE_BAD_REQUEST' });
    assert.throws(() => validateAnalysisRequest({ fen: `${START_FEN}\ngo infinite` }), { code: 'ENGINE_BAD_REQUEST' });
    assert.throws(() => new PikafishEngine({ threads: 0 }), { code: 'ENGINE_BAD_CONFIG' });
});

test('PV parser keeps one exact principal line, rejects bounds and does not carry old probabilities', () => {
    const exact = 'info depth 12 seldepth 18 multipv 1 score cp 30 wdl 110 850 40 nodes 12345 time 202 pv b2e2 h9g7';
    const expected = { depth: 12, score: { type: 'cp', value: 30, perspective: 'sideToMove' },
        wdl: { win: 110, draw: 850, loss: 40, scale: 1000, perspective: 'sideToMove' }, pv: ['b2e2', 'h9g7'], nodes: 12345 };
    assert.deepEqual(parsePrincipalVariation(exact), expected);
    for (const line of [exact.replace('multipv 1', 'multipv 2'), exact.replace('cp 30', 'cp 30 lowerbound'),
        exact.replace('cp 30', 'cp 30 upperbound'), 'info depth 99 currmove a0a1 currmovenumber 2',
        'info depth 15 wdl 999 1 0 pv a0a1', exact.replace('pv b2e2 h9g7', 'pv b2e2 quit')]) {
        assert.equal(parsePrincipalVariation(line), null);
    }
    assert.equal(parsePrincipalVariation(exact.replace(' wdl 110 850 40', '')).wdl, null);
    assert.equal(parsePrincipalVariation(exact.replace('110 850 40', '111 850 40')).wdl, null);
    assert.deepEqual(parsePrincipalVariation(exact.replace('cp 30', 'mate -5')).score,
        { type: 'mate', value: -5, perspective: 'sideToMove' });
    // Exercise the live parser: incomplete and bound info must not mix with its last exact report.
    const engine = new PikafishEngine();
    const session = { closed: false, waiters: new Set() };
    engine.session = session;
    engine.active = { session, searching: true, settled: false, stats: {} };
    engine._onLine(session, exact);
    engine._onLine(session, 'info depth 99 currmove a0a1 currmovenumber 2');
    engine._onLine(session, exact.replace('depth 12', 'depth 13').replace('cp 30', 'cp 80 lowerbound'));
    assert.deepEqual(engine.active.stats, expected);
});

test('analysis engine emits real WDL from the moving black side and a legal principal variation', { timeout: 25000 }, async t => {
    const engine = new PikafishEngine({ threads: 2, hashMb: 128 });
    t.after(() => engine.dispose());
    const info = await engine.engineInfo();
    assert.equal(info.threads, 2);
    assert.equal(info.hashMb, 128);
    assert.equal(info.wdlAvailable, true);
    // Black is missing a rook; changing the mover must change the evaluation's perspective.
    const disadvantagedBlack = START_FEN.replace('rnbakabnr', '1nbakabnr').replace(' w ', ' b ');
    const result = await engine.analysisEvaluate({ fen: disadvantagedBlack, seconds: 1 });
    assert.equal(result.score.perspective, 'sideToMove');
    assert.ok(result.score.value < 0);
    assert.ok(result.wdl.loss > result.wdl.win);
    assert.equal(result.wdl.scale, 1000);
    assert.equal(result.wdl.win + result.wdl.draw + result.wdl.loss, 1000);
    assert.ok(result.depth > 0 && result.nodes > 0);
    assert.ok(result.timeMs >= 700 && result.timeMs < 10000);
    assert.ok(result.pv.length > 0);
    // Replay its first move through the engine's own legality validation.
    const after = await engine.engineMove({ fen: disadvantagedBlack, moves: [result.pv[0]], difficulty: 'easy' });
    assert.ok(after.score.value > 0, 'After the black move, the same material advantage is positive for red');
    t.diagnostic(JSON.stringify({ side: 'black', score: result.score, wdl: result.wdl, depth: result.depth, pv: result.pv }));
});

test('independent analysis and playing processes can cancel in either direction without crossing replies', { timeout: 30000 }, async t => {
    const playing = new PikafishEngine();
    const analysis = new PikafishEngine({ threads: 2, hashMb: 128 });
    t.after(() => { playing.dispose(); analysis.dispose(); });
    await Promise.all([playing.engineInfo(), analysis.engineInfo()]);
    assert.notEqual(playing.session.child.pid, analysis.session.child.pid);
    const playingPid = playing.session.child.pid;
    const move = playing.engineMove({ difficulty: 'custom', seconds: 1 });
    const pendingAnalysis = analysis.analysisEvaluate({ moves: ['b2e2'], seconds: 3 });
    const cancelledAnalysis = assert.rejects(pendingAnalysis, { code: 'ENGINE_CANCELLED' });
    await delay(100);
    assert.deepEqual(analysis.engineStop(), { stopped: true });
    await cancelledAnalysis;
    assert.equal(playing.session.child.pid, playingPid);
    assert.ok(INITIAL_LEGAL_MOVES.has((await move).move));

    const freshAnalysis = analysis.analysisEvaluate({ seconds: 1 });
    const pendingMove = playing.engineMove({ difficulty: 'custom', seconds: 3 });
    const cancelledMove = assert.rejects(pendingMove, { code: 'ENGINE_CANCELLED' });
    await delay(100);
    playing.engineStop();
    await cancelledMove;
    const fresh = await freshAnalysis;
    assert.ok(INITIAL_LEGAL_MOVES.has(fresh.move), `Stale black-side analysis: ${fresh.move}`);
    assert.equal(fresh.wdl.win + fresh.wdl.draw + fresh.wdl.loss, 1000);
});
