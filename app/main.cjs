'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');
const { PikafishEngine, EngineError } = require('./engine.cjs');

const indexPath = path.join(__dirname, 'index.html');
const isTest = process.env.WILD_CHESS_TEST === '1';
const engine = new PikafishEngine();
const analysisEngine = new PikafishEngine({ threads: 2, hashMb: 128 });
let window = null;

function stopEngines() {
    engine.engineStop();
    analysisEngine.engineStop();
}

function isLocalEntry(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'file:' && path.resolve(fileURLToPath(parsed)) === path.resolve(indexPath);
    } catch { return false; }
}

function registerBridge() {
    const handlers = {
        'wild-chess:engine-move': request => engine.engineMove(request),
        'wild-chess:engine-stop': () => engine.engineStop(),
        'wild-chess:engine-info': () => engine.engineInfo(),
        'wild-chess:analysis-evaluate': request => analysisEngine.analysisEvaluate(request),
        'wild-chess:analysis-stop': () => analysisEngine.engineStop(),
    };
    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, async (event, request) => {
            try {
                if (!window || event.sender !== window.webContents ||
                    event.senderFrame !== window.webContents.mainFrame || !isLocalEntry(event.senderFrame.url)) {
                    throw new EngineError('ENGINE_FORBIDDEN', '只允许本地棋盘调用引擎。');
                }
                return { ok: true, result: await handler(request) };
            } catch (error) {
                return { ok: false, error: { code: error.code || 'ENGINE_INTERNAL_ERROR', message: error.message || '引擎发生错误。' } };
            }
        });
    }
}

function createWindow() {
    window = new BrowserWindow({
        width: 1440, height: 1000, minWidth: 1100, minHeight: 800,
        title: '荒野象棋', backgroundColor: '#191713', autoHideMenuBar: true,
        icon: path.join(__dirname, 'assets/app-icon.ico'),
        show: !isTest,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !isTest, offscreen: isTest },
    });
    window.setMenu(null);
    window.on('page-title-updated', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!isLocalEntry(url)) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('render-process-gone', stopEngines);
    window.on('closed', () => { window = null; stopEngines(); });
    window.loadFile(indexPath);
}

const userDataPath = path.join(__dirname, isTest ? 'userdata-test' : 'userdata');
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
    });
    app.whenReady().then(() => { registerBridge(); createWindow(); });
    app.on('activate', () => { if (!window) createWindow(); });
    app.on('window-all-closed', () => app.quit());
    app.on('before-quit', () => { engine.dispose(); analysisEngine.dispose(); });
}
