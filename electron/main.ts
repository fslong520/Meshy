/**
 * Meshy Electron Main Process
 *
 * 架构：
 *   1. 启动后端守护进程（DaemonServer）
 *   2. 创建 BrowserWindow 加载前端
 *   3. 通过 IPC 暴露原生 API（文件对话框、路径等）
 *
 * 注意：本文件由 tsc 编译为 CommonJS（因 package.json 中 "type": "commonjs"），
 * 故使用 __dirname 而非 import.meta.dirname。
 */
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fork } from 'child_process';
import http from 'http';

let mainWindow: BrowserWindow | null = null;
let daemonProcess: any = null;

const isDev = !app.isPackaged;
const WS_PORT = parseInt(process.env.MESHY_WS_PORT || '9120', 10);

// ─── 等待后端 HTTP 服务器就绪 ───
function waitForServer(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        // 只要能收到响应就认为就绪
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`后端服务器在 ${timeoutMs}ms 内未就绪`));
        } else {
          setTimeout(poll, 500);
        }
      });
      req.end();
    };
    poll();
  });
}

// ─── 启动后端守护进程 ───
function startDaemon(): void {
  // 开发模式：直接 fork 已有的 src/index.ts（由 tsx 转译）
  // 生产模式：运行打包好的 dist/index.js
  const entryPoint = isDev
    ? path.resolve(__dirname, '..', 'src', 'index.ts')
    : path.resolve(__dirname, '..', 'dist', 'index.js');

  const runner = isDev ? require.resolve('tsx') : entryPoint;

  daemonProcess = fork(
    runner,
    isDev
      ? [entryPoint, 'server', '--port', String(WS_PORT)]
      : ['server', '--port', String(WS_PORT)],
    {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, MESHY_WS_PORT: String(WS_PORT) },
    },
  );

  daemonProcess.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    console.log(`[Daemon] ${text}`);
    // 把日志也转发到渲染进程
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('daemon:log', text);
    }
  });

  daemonProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    console.error(`[Daemon:err] ${text}`);
  });

  daemonProcess.on('exit', (code: number | null) => {
    console.log(`[Daemon] Process exited with code ${code}`);
    daemonProcess = null;
  });

  console.log(`[Electron] Daemon started (PID: ${daemonProcess.pid})`);
}

// ─── 创建窗口 ───
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    backgroundColor: '#0e121f',
    show: false,
    title: 'Meshy',
  });

  // 开发模式 → Vite dev server（有代理）；生产模式 → 后端自身的 HTTP 服务器
  const loadUrl = isDev
    ? `http://localhost:5173`
    : `http://localhost:${WS_PORT}`;

  if (isDev) {
    mainWindow.loadURL(loadUrl);
    // 默认不打开 DevTools，设置 MESHY_DEVTOOLS=1 或传 --dev 参数时才打开
    if (process.env.MESHY_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'bottom' });
    }
  } else {
    // 生产模式：先等后端服务器就绪
    waitForServer(WS_PORT, 30_000).then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(loadUrl);
      }
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC 处理器（原生能力） ───
function registerIpcHandlers(): void {
  // 选择目录 — 返回完整文件系统路径
  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return { canceled: true, path: null };

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择工作区目录',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    const realPath = result.filePaths[0];

    // 过滤系统目录
    const baseName = path.basename(realPath);
    if (baseName.startsWith('.')) {
      return {
        canceled: true,
        path: null,
        error: `"${baseName}" 是系统隐藏目录，请选择项目文件夹。`,
      };
    }
    if (['node_modules', 'dist', 'build'].includes(baseName)) {
      return {
        canceled: true,
        path: null,
        error: `"${baseName}" 是构建/依赖目录，请选择项目根目录。`,
      };
    }

    return { canceled: false, path: realPath };
  });

  // 检查目录是否存在且可访问
  ipcMain.handle('fs:verifyDir', async (_event, dirPath: string) => {
    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        return { valid: false, error: '不是目录' };
      }
      fs.readdirSync(dirPath); // 检查权限
      return { valid: true, entries: fs.readdirSync(dirPath) };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  });

  // 检查路径是否存在
  ipcMain.handle('fs:exists', async (_event, dirPath: string) => {
    return fs.existsSync(dirPath);
  });

  // 获取路径信息
  ipcMain.handle('fs:getPath', async (_event, filePath: string) => {
    return path.resolve(filePath);
  });

  // 读取目录
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      return fs.readdirSync(dirPath);
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // 获取后端 WS 端口
  ipcMain.handle('app:getWsPort', () => WS_PORT);

  // 获取应用信息
  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
  }));
}

// ─── 生命周期 ───
app.whenReady().then(() => {
  registerIpcHandlers();

  // 开发模式下后端由 dev.sh 管理，生产模式下由 Electron 启动
  if (!isDev) {
    startDaemon();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
  }
});
