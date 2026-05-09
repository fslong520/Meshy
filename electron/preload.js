/**
 * Preload Script
 * 在渲染进程和主进程之间建立安全的通信桥梁
 * 通过 contextBridge 暴露安全的 API 给前端
 */
const { contextBridge, ipcRenderer } = require('electron');

// 暴露 API 给前端
contextBridge.exposeInMainWorld('electronAPI', {
  // 选择目录对话框
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  
  // 文件系统操作
  fs: {
    getPath: (filePath) => ipcRenderer.invoke('fs:getPath', filePath),
    exists: (dirPath) => ipcRenderer.invoke('fs:exists', dirPath),
    readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
    verifyDir: (dirPath) => ipcRenderer.invoke('fs:verifyDir', dirPath),
  },
  
  // 应用信息
  app: {
    getWsPort: () => ipcRenderer.invoke('app:getWsPort'),
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
  },
  
  // 监听来自主进程的消息
  onMainMessage: (callback) => {
    ipcRenderer.on('main-message', (_event, data) => callback(data));
  },
  
  // 发送消息给主进程
  sendToMain: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
});