'use strict';
// Verifies the actual ZIP after extraction into a fresh Unicode/spaced path.
// Uses its Electron and bundled engines; no project runtime or engine fallback.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { _electron } = require('playwright-core');
const project = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const archive = path.resolve(process.argv[2] || path.join(project, 'dist', `wilderness-xiangqi-${version}-windows-x64.zip`));
const destination = path.join(project, '.cache', `便携包验证 空格-${Date.now()}`);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)}, ${quote(destination)})`;
const extraction = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
assert.equal(extraction.status, 0, extraction.stderr);
const root = path.join(destination, `wilderness-xiangqi-${version}-windows-x64`);
const report = { ok: false, archive: path.basename(archive), checks: [], rendererErrors: [], externalRequests: [] };
const record = (name, data = {}) => { report.checks.push({ name, ...data }); console.log(`PASS ${name}`); };
let application, page;
async function state() { return page.evaluate(() => window.__test.getPublicGame()); }
async function start(variant, mode) {
    if (await page.locator('#game-screen').isVisible()) await page.locator('#menu-open').click();
    if (await page.locator('#setup-screen').isVisible()) await page.locator('#home-back').click();
    await page.locator(`[data-start-variant="${variant}"]`).click();
    await page.locator(`[data-mode="${mode}"]`).click();
    for (const selector of ['#red-level', '#black-level']) await page.locator(selector).selectOption('easy', { force: true });
    await page.locator('#start').click();
    if (await page.locator('#confirm-dialog').isVisible()) await page.locator('#confirm-ok').click();
    await page.waitForSelector('#game-screen', { state: 'visible' });
}
async function move() {
    const before = await state();
    const action = await page.evaluate(async () => (await import('./core/rules.mjs')).legalMoves(window.__test.getPublicGame())[0]);
    assert.ok(action);
    await page.locator(`[data-square="${action.from}"]`).click();
    await page.locator(`[data-square="${action.to}"]`).click();
    await page.waitForFunction(ply => window.__test.getPublicGame().ply >= ply, before.ply + 2, { timeout: 30000 });
}
(async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'));
    for (const file of manifest.files) {
        const resolved = path.resolve(root, file.path);
        assert.ok(resolved.startsWith(root + path.sep), `Unexpected manifest path ${file.path}`);
        const data = fs.readFileSync(resolved);
        assert.equal(data.length, file.bytes);
        assert.equal(crypto.createHash('sha256').update(data).digest('hex'), file.sha256, file.path);
        assert.doesNotMatch(file.path, /(?:^|\/)(?:node_modules|userdata(?:-test)?|\.git|\.cache)(?:\/|$)/);
    }
    record('all packaged files match SHA256 manifest; no personal settings or dependencies', { files: manifest.files.length });
    assert.ok(fs.existsSync(path.join(root, '荒野象棋.exe')));
    const exe = fs.readFileSync(path.join(root, '荒野象棋.exe'));
    const peOffset = exe.readUInt32LE(0x3c);
    assert.equal(exe.readUInt16LE(peOffset + 24 + 68), 2, 'Native launcher must use the Windows GUI subsystem');
    record('native Windows launcher has no console subsystem');
    const env = { ...process.env, WILD_CHESS_TEST: '1' };
    delete env.ELECTRON_RUN_AS_NODE; delete env.WILD_CHESS_ENGINE_PATH;
    application = await _electron.launch({ executablePath: path.join(root, 'runtime/electron.exe'), args: [root], cwd: destination, env, timeout: 30000 });
    await application.evaluate(({ BrowserWindow, session }) => {
        BrowserWindow.getAllWindows().forEach(win => win.webContents.setAudioMuted(true));
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    });
    page = await application.firstWindow({ timeout: 30000 });
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) report.externalRequests.push(request.url()); });
    await page.waitForSelector('#home-screen', { state: 'visible' });
    await page.evaluate(async () => { window.__test = await import('./app.mjs'); });
    assert.equal(await page.locator('#game-screen').isVisible(), false);
    const details = await application.evaluate(async ({ app, BrowserWindow }, launcher) => ({
        appPath: app.getAppPath(), visible: BrowserWindow.getAllWindows()[0].isVisible(),
        iconEmpty: (await app.getFileIcon(launcher)).isEmpty(), userData: app.getPath('userData'),
    }), path.join(root, '荒野象棋.exe'));
    assert.equal(details.appPath, root);
    assert.equal(details.visible, false);
    assert.equal(details.iconEmpty, false);
    assert.equal(details.userData, path.join(root, 'app/userdata-test'));
    record('fresh extracted package opens main menu with local icon and isolated settings');
    const info = await page.evaluate(() => window.chessAPI.engineInfo());
    assert.equal(info.available, true); assert.equal(info.wdlAvailable, true);
    assert.match(info.engine, /Pikafish 2026-09-06/);
    await start('standard', 'human-ai'); await move();
    await page.waitForFunction(() => {
        const s = window.__test.getPublicGame(), a = window.__test.getAnalysisState();
        return !a.busy && a.current?.ply === s.ply && a.current?.rawWdl;
    }, null, { timeout: 30000 });
    const analysis = await page.evaluate(() => window.__test.getAnalysisState().current);
    assert.equal(analysis.rawWdl.win + analysis.rawWdl.draw + analysis.rawWdl.loss, 1000);
    record('ordinary human-AI makes real engine move and independent native WDL analysis', { ply: (await state()).ply, depth: analysis.depth, wdl: analysis.rawWdl });
    await start('jieqi', 'human-ai');
    assert.equal((await state()).board.filter(piece => piece?.covered).length, 30);
    await move();
    const mixed = await state();
    assert.ok(mixed.ply >= 2);
    // AI may legally move its general or a newly revealed enemy-colored piece;
    // only the human's opening move is guaranteed to uncover a new piece.
    assert.ok(mixed.board.filter(piece => piece?.covered).length <= 29);
    assert.doesNotMatch(JSON.stringify(mixed), /"(?:hidden|permutation|seed)"\s*:/);
    record('mixed Jieqi worker runs from extracted package and keeps concealed identities private', { ply: mixed.ply });
    assert.deepEqual(report.rendererErrors, []);
    assert.deepEqual(report.externalRequests, []);
    record('all checks pass with HTTP(S) blocked and no renderer errors');
    report.ok = true;
})().catch(error => { report.error = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
    if (application) await application.close().catch(() => {});
    fs.mkdirSync(path.join(project, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(project, 'dist/portable-validation.json'), JSON.stringify(report, null, 2) + '\n');
});
