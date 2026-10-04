'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, request) {
    const response = await ipcRenderer.invoke(channel, request);
    if (!response || !response.ok) {
        const error = new Error(response?.error?.message || '本地引擎通信失败。');
        error.code = response?.error?.code || 'ENGINE_IPC_ERROR';
        throw error;
    }
    return response.result;
}

contextBridge.exposeInMainWorld('chessAPI', Object.freeze({
    engineMove: request => invoke('wild-chess:engine-move', request),
    engineStop: () => invoke('wild-chess:engine-stop'),
    engineInfo: () => invoke('wild-chess:engine-info'),
    analysisEvaluate: request => invoke('wild-chess:analysis-evaluate', request),
    analysisStop: () => invoke('wild-chess:analysis-stop'),
}));
