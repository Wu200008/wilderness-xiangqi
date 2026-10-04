'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

// Resolve only our bundled engine or an explicitly supplied absolute executable.
// Never search PATH or depend on a separate GUI installation.
const overridePath = process.env.WILD_CHESS_ENGINE_PATH;
if (overridePath && !path.isAbsolute(overridePath)) throw new Error('WILD_CHESS_ENGINE_PATH 必须是引擎的绝对路径。');
const ENGINE_PATH = overridePath || path.resolve(__dirname, '../engines/pikafish/pikafish.exe');
const NODE_BUDGETS = Object.freeze({ easy: 1000, medium: 10000, hard: 100000 });
const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'expert', 'custom']);

class EngineError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'EngineError';
        this.code = code;
    }
}

function validateRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new EngineError('ENGINE_BAD_REQUEST', '引擎请求必须是对象。');
    }
    const difficulty = request.difficulty || 'expert';
    if (!DIFFICULTIES.includes(difficulty)) {
        throw new EngineError('ENGINE_BAD_REQUEST', '未知的电脑难度。');
    }
    let position = 'startpos';
    if (request.fen !== undefined && request.fen !== null && request.fen !== '') {
        if (typeof request.fen !== 'string' || request.fen.length > 220 || /[\r\n]/.test(request.fen)) {
            throw new EngineError('ENGINE_BAD_REQUEST', '局面格式无效。');
        }
        const fields = request.fen.trim().split(/\s+/);
        if (fields.length === 2) fields.push('-', '-', '0', '1');
        const ranks = (fields[0] || '').split('/');
        const validBoard = ranks.length === 10 && ranks.every(rank =>
            /^[1-9rnbakcpheRNBAKCPHE]+$/.test(rank) &&
            [...rank].reduce((sum, character) => sum + (/\d/.test(character) ? Number(character) : 1), 0) === 9);
        if (!validBoard || fields.length !== 6 || !/^[wrb]$/.test(fields[1]) ||
            fields[2] !== '-' || fields[3] !== '-' || !/^\d{1,7}$/.test(fields[4]) || !/^[1-9]\d{0,6}$/.test(fields[5])) {
            throw new EngineError('ENGINE_BAD_REQUEST', '局面不是有效的中国象棋 FEN。');
        }
        fields[1] = fields[1] === 'r' ? 'w' : fields[1];
        position = `fen ${fields.join(' ')}`;
    }
    if (request.moves !== undefined) {
        if (!Array.isArray(request.moves) || request.moves.length > 5000 ||
            !Array.from(request.moves).every(move => typeof move === 'string' && /^[a-i][0-9][a-i][0-9]$/.test(move) && move.slice(0, 2) !== move.slice(2))) {
            throw new EngineError('ENGINE_BAD_REQUEST', '历史着法必须是 UCI 着法数组。');
        }
        if (request.moves.length) position += ` moves ${request.moves.join(' ')}`;
    }
    let milliseconds = 3000;
    if (difficulty === 'custom') {
        const seconds = request.seconds === undefined ? 3 : Number(request.seconds);
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30) {
            throw new EngineError('ENGINE_BAD_REQUEST', '自定义思考时间须为 1–30 秒。');
        }
        milliseconds = Math.round(seconds * 1000);
    }
    const nodes = NODE_BUDGETS[difficulty];
    return { position, difficulty, milliseconds, command: nodes ? `go nodes ${nodes}` : `go movetime ${milliseconds}` };
}

function validateAnalysisRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new EngineError('ENGINE_BAD_REQUEST', '分析请求必须是对象。');
    }
    const seconds = request.seconds === undefined ? 1 : request.seconds;
    if (seconds !== 1 && seconds !== 3) {
        throw new EngineError('ENGINE_BAD_REQUEST', '局势分析时间须为 1 秒或 3 秒。');
    }
    return validateRequest({ fen: request.fen, moves: request.moves, difficulty: 'custom', seconds });
}

// Keep a complete, exact PV1 report together. Iteration/progress and bound-only
// lines must never replace just the depth or probability of an older score.
function parsePrincipalVariation(line) {
    if (!line.startsWith('info ') || line.startsWith('info string')) return null;
    const multipv = line.match(/\bmultipv (\d+)\b/);
    if (multipv && Number(multipv[1]) !== 1) return null;
    if (/\b(?:lowerbound|upperbound)\b/.test(line)) return null;
    const depth = line.match(/\bdepth (\d+)\b/);
    const score = line.match(/\bscore (cp|mate) (-?\d+)\b/);
    const variation = line.match(/\bpv (.+)$/);
    if (!depth || !score || !variation) return null;
    const pv = variation[1].trim().split(/\s+/);
    if (!pv.every(move => /^[a-i][0-9][a-i][0-9]$/.test(move) && move.slice(0, 2) !== move.slice(2))) return null;
    const probabilities = line.match(/\bwdl (\d+) (\d+) (\d+)\b/);
    let wdl = null;
    if (probabilities) {
        // Pikafish-2026-09-06/src/uci.cpp:545-553 emits win/draw/loss per mille.
        // search.cpp:1793-1848 uses the root side-to-move score for this model.
        // Missing/malformed WDL stays null; cp is never converted to a probability here.
        const [win, draw, loss] = probabilities.slice(1).map(Number);
        if ([win, draw, loss].every(value => value >= 0 && value <= 1000) && win + draw + loss === 1000) {
            wdl = { win, draw, loss, scale: 1000, perspective: 'sideToMove' };
        }
    }
    const nodes = line.match(/\bnodes (\d+)\b/);
    return { depth: Number(depth[1]), score: { type: score[1], value: Number(score[2]), perspective: 'sideToMove' },
        wdl, pv, nodes: nodes ? Number(nodes[1]) : 0 };
}

class PikafishEngine {
    constructor({ threads = 8, hashMb = 512 } = {}) {
        if (!Number.isInteger(threads) || threads < 1 || threads > 1024 ||
            !Number.isInteger(hashMb) || hashMb < 1 || hashMb > 65536) {
            throw new EngineError('ENGINE_BAD_CONFIG', '本地引擎的线程数或缓存大小无效。');
        }
        this.threads = threads;
        this.hashMb = hashMb;
        this.session = null;
        this.active = null;
        this.disposed = false;
        this.engineName = 'Pikafish 2026-09-06';
    }

    _send(session, command) {
        if (this.session !== session || session.closed || !session.child.stdin.writable) {
            throw new EngineError('ENGINE_UNAVAILABLE', '本地引擎连接已关闭。');
        }
        session.child.stdin.write(`${command}\n`);
    }

    _waitFor(session, predicate, timeoutMs, description) {
        return new Promise((resolve, reject) => {
            const waiter = { predicate, resolve, reject, timer: null };
            waiter.timer = setTimeout(() => {
                this._destroySession(session, new EngineError('ENGINE_TIMEOUT', `${description}超时，请重试。`));
            }, timeoutMs);
            session.waiters.add(waiter);
        });
    }

    async _sendAndWait(session, command, predicate, description) {
        const waiting = this._waitFor(session, predicate, 15000, description);
        try { this._send(session, command); }
        catch (error) { this._destroySession(session, error); }
        return waiting;
    }

    _finishActive(active, error, result) {
        if (active.settled) return;
        active.settled = true;
        clearTimeout(active.timer);
        if (this.active === active) this.active = null;
        if (error) active.reject(error);
        else active.resolve(result);
    }

    _destroySession(session, error) {
        if (!session || session.closed) return;
        session.closed = true;
        if (this.session === session) this.session = null;
        for (const waiter of session.waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
        session.waiters.clear();
        if (this.active && this.active.session === session) this._finishActive(this.active, error);
        // Retiring this whole process ensures a late bestmove cannot belong to a new game.
        try { session.child.stdin.end(); } catch { /* Process may already be gone. */ }
        try { session.child.kill(); } catch { /* Process may already be gone. */ }
    }

    _onLine(session, line) {
        if (this.session !== session || session.closed) return;
        if (line.startsWith('id name ')) this.engineName = line.slice(8).trim();
        if (/^option name UCI_ShowWDL type check\b/.test(line)) session.supportsWdl = true;
        if (/CRITICAL ERROR|ERROR:|ERROR\b.*(?:NNUE|EvalFile)/i.test(line)) {
            this._destroySession(session, new EngineError('ENGINE_POSITION_ERROR', `皮卡鱼报告错误：${line.slice(0, 500)}`));
            return;
        }
        for (const waiter of [...session.waiters]) {
            if (waiter.predicate(line)) {
                clearTimeout(waiter.timer);
                session.waiters.delete(waiter);
                waiter.resolve(line);
            }
        }
        const active = this.active;
        if (!active || active.session !== session || !active.searching || active.settled) return;
        if (line.startsWith('info ') && !line.startsWith('info string')) {
            const report = parsePrincipalVariation(line);
            if (report) active.stats = report;
        } else if (line.startsWith('bestmove ')) {
            const move = line.split(/\s+/)[1];
            if (!/^[a-i][0-9][a-i][0-9]$/.test(move)) {
                this._finishActive(active, new EngineError('ENGINE_NO_MOVE', '当前局面没有可走的合法着法。'));
                return;
            }
            this._finishActive(active, null, {
                move,
                depth: active.stats.depth,
                score: active.stats.score,
                wdl: active.stats.wdl,
                pv: active.stats.pv,
                nodes: active.stats.nodes,
                timeMs: Math.round(performance.now() - active.startedAt),
                engine: this.engineName,
            });
        }
    }

    async _initialize(session) {
        await this._sendAndWait(session, 'uci', line => line === 'uciok', '引擎 UCI 握手');
        this._send(session, 'setoption name EvalFile value pikafish.nnue');
        this._send(session, `setoption name Threads value ${this.threads}`);
        this._send(session, `setoption name Hash value ${this.hashMb}`);
        if (session.supportsWdl) this._send(session, 'setoption name UCI_ShowWDL value true');
        await this._sendAndWait(session, 'isready', line => line === 'readyok', '引擎初始化');
        session.ready = true;
        return session;
    }

    _ensureReady() {
        if (this.disposed) return Promise.reject(new EngineError('ENGINE_DISPOSED', '引擎已关闭。'));
        if (this.session) return this.session.readyPromise;
        if (!fs.existsSync(ENGINE_PATH) || !fs.existsSync(path.join(path.dirname(ENGINE_PATH), 'pikafish.nnue'))) {
            return Promise.reject(new EngineError('ENGINE_MISSING', '找不到本地皮卡鱼引擎或 pikafish.nnue 模型文件。'));
        }
        let child;
        try {
            child = spawn(ENGINE_PATH, [], { cwd: path.dirname(ENGINE_PATH), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (error) {
            return Promise.reject(new EngineError('ENGINE_START_FAILED', `无法启动本地引擎：${error.message}`));
        }
        const session = { child, ready: false, closed: false, supportsWdl: false, waiters: new Set(), buffer: '', stderr: '', readyPromise: null };
        this.session = session;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', data => {
            session.buffer += data;
            const lines = session.buffer.split(/\r?\n/);
            session.buffer = lines.pop();
            for (const line of lines) this._onLine(session, line.trim());
        });
        child.stderr.on('data', data => { session.stderr = (session.stderr + data).slice(-1000); });
        child.on('error', error => this._destroySession(session, new EngineError('ENGINE_START_FAILED', `引擎启动失败：${error.message}`)));
        child.stdin.on('error', error => this._destroySession(session, new EngineError('ENGINE_IO_ERROR', `引擎通信失败：${error.message}`)));
        child.on('close', code => this._destroySession(session, new EngineError('ENGINE_EXITED', `引擎意外退出（${code}）。${session.stderr}`)));
        session.readyPromise = this._initialize(session).catch(error => {
            this._destroySession(session, error);
            throw error;
        });
        return session.readyPromise;
    }

    engineMove(request) {
        let parsed;
        try { parsed = validateRequest(request); }
        catch (error) { return Promise.reject(error); }
        return this._search(parsed);
    }

    analysisEvaluate(request) {
        let parsed;
        try { parsed = validateAnalysisRequest(request); }
        catch (error) { return Promise.reject(error); }
        return this._search(parsed);
    }

    _search(parsed) {
        if (this.disposed) return Promise.reject(new EngineError('ENGINE_DISPOSED', '引擎已关闭。'));
        if (this.active) return Promise.reject(new EngineError('ENGINE_BUSY', '电脑正在思考，请先停止当前搜索。'));
        let active;
        const result = new Promise((resolve, reject) => {
            active = { resolve, reject, settled: false, searching: false, session: null, timer: null,
                stats: { depth: 0, score: null, wdl: null, pv: [], nodes: 0 }, startedAt: 0 };
        });
        this.active = active;
        const ready = this._ensureReady();
        active.session = this.session;
        ready.then(async session => {
            if (active.settled || this.active !== active) return;
            active.session = session;
            // Reset engine game state; history, when provided, remains in the position command.
            this._send(session, 'ucinewgame');
            await this._sendAndWait(session, 'isready', line => line === 'readyok', '引擎准备新搜索');
            if (active.settled || this.active !== active) return;
            this._send(session, `position ${parsed.position}`);
            active.startedAt = performance.now();
            active.searching = true;
            active.timer = setTimeout(() => this._destroySession(session, new EngineError('ENGINE_TIMEOUT', '引擎搜索超时，请重试。')),
                NODE_BUDGETS[parsed.difficulty] ? 30000 : parsed.milliseconds + 15000);
            this._send(session, parsed.command);
        }).catch(error => this._finishActive(active, error));
        return result;
    }

    engineStop() {
        const stopped = Boolean(this.active && !this.active.settled);
        const error = new EngineError('ENGINE_CANCELLED', '本次电脑思考已取消。');
        if (this.active) this._finishActive(this.active, error);
        this._destroySession(this.session, error);
        return { stopped };
    }

    async engineInfo() {
        const session = await this._ensureReady();
        return { available: true, engine: this.engineName, threads: this.threads, hashMb: this.hashMb,
            wdlAvailable: session.supportsWdl, local: true, busy: Boolean(this.active),
            difficulties: { easy: { nodes: 1000 }, medium: { nodes: 10000 }, hard: { nodes: 100000 }, expert: { seconds: 3 }, custom: { minSeconds: 1, maxSeconds: 30 } } };
    }

    dispose() {
        this.disposed = true;
        this.engineStop();
    }
}

module.exports = { PikafishEngine, EngineError, validateRequest, validateAnalysisRequest, parsePrincipalVariation };
