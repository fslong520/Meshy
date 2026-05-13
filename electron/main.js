"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
var electron_1 = require("electron");
var path_1 = __importDefault(require("path"));
var fs_1 = __importDefault(require("fs"));
var child_process_1 = require("child_process");
var http_1 = __importDefault(require("http"));
var mainWindow = null;
var daemonProcess = null;
var isDev = !electron_1.app.isPackaged;
var WS_PORT = parseInt(process.env.MESHY_WS_PORT || '9120', 10);
// ─── 等待后端 HTTP 服务器就绪 ───
function waitForServer(port, timeoutMs) {
    return new Promise(function (resolve, reject) {
        var start = Date.now();
        var poll = function () {
            var req = http_1.default.get("http://localhost:".concat(port, "/"), function (res) {
                // 只要能收到响应就认为就绪
                res.resume();
                resolve();
            });
            req.on('error', function () {
                if (Date.now() - start > timeoutMs) {
                    reject(new Error("\u540E\u7AEF\u670D\u52A1\u5668\u5728 ".concat(timeoutMs, "ms \u5185\u672A\u5C31\u7EEA")));
                }
                else {
                    setTimeout(poll, 500);
                }
            });
            req.end();
        };
        poll();
    });
}
// ─── 启动后端守护进程 ───
function startDaemon() {
    var _a, _b;
    // 开发模式：直接 fork 已有的 src/index.ts（由 tsx 转译）
    // 生产模式：运行打包好的 dist/index.js
    var entryPoint = isDev
        ? path_1.default.resolve(__dirname, '..', 'src', 'index.ts')
        : path_1.default.resolve(__dirname, '..', 'dist', 'index.js');
    var runner = isDev ? require.resolve('tsx') : entryPoint;
    daemonProcess = (0, child_process_1.fork)(runner, isDev
        ? [entryPoint, 'server', '--port', String(WS_PORT)]
        : ['server', '--port', String(WS_PORT)], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: __assign(__assign({}, process.env), { MESHY_WS_PORT: String(WS_PORT) }),
    });
    (_a = daemonProcess.stdout) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
        var text = chunk.toString();
        console.log("[Daemon] ".concat(text));
        // 把日志也转发到渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('daemon:log', text);
        }
    });
    (_b = daemonProcess.stderr) === null || _b === void 0 ? void 0 : _b.on('data', function (chunk) {
        var text = chunk.toString();
        console.error("[Daemon:err] ".concat(text));
    });
    daemonProcess.on('exit', function (code) {
        console.log("[Daemon] Process exited with code ".concat(code));
        daemonProcess = null;
    });
    console.log("[Electron] Daemon started (PID: ".concat(daemonProcess.pid, ")"));
}
// ─── 创建窗口 ───
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        webPreferences: {
            preload: path_1.default.resolve(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
        backgroundColor: '#0e121f',
        show: false,
        title: 'Meshy',
    });
    // 开发模式 → Vite dev server（有代理）；生产模式 → 后端自身的 HTTP 服务器
    var loadUrl = isDev
        ? "http://localhost:5173"
        : "http://localhost:".concat(WS_PORT);
    if (isDev) {
        mainWindow.loadURL(loadUrl);
        // 默认不打开 DevTools，设置 MESHY_DEVTOOLS=1 或传 --dev 参数时才打开
        if (process.env.MESHY_DEVTOOLS === '1') {
            mainWindow.webContents.openDevTools({ mode: 'bottom' });
        }
    }
    else {
        // 生产模式：先等后端服务器就绪
        waitForServer(WS_PORT, 30000).then(function () {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(loadUrl);
            }
        });
    }
    mainWindow.once('ready-to-show', function () {
        mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.show();
    });
    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}
// ─── IPC 处理器（原生能力） ───
function registerIpcHandlers() {
    var _this = this;
    // 选择目录 — 返回完整文件系统路径
    electron_1.ipcMain.handle('dialog:openDirectory', function () { return __awaiter(_this, void 0, void 0, function () {
        var result, realPath, baseName;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!mainWindow)
                        return [2 /*return*/, { canceled: true, path: null }];
                    return [4 /*yield*/, electron_1.dialog.showOpenDialog(mainWindow, {
                            properties: ['openDirectory'],
                            title: '选择工作区目录',
                        })];
                case 1:
                    result = _a.sent();
                    if (result.canceled || result.filePaths.length === 0) {
                        return [2 /*return*/, { canceled: true, path: null }];
                    }
                    realPath = result.filePaths[0];
                    baseName = path_1.default.basename(realPath);
                    if (baseName.startsWith('.')) {
                        return [2 /*return*/, {
                                canceled: true,
                                path: null,
                                error: "\"".concat(baseName, "\" \u662F\u7CFB\u7EDF\u9690\u85CF\u76EE\u5F55\uFF0C\u8BF7\u9009\u62E9\u9879\u76EE\u6587\u4EF6\u5939\u3002"),
                            }];
                    }
                    if (['node_modules', 'dist', 'build'].includes(baseName)) {
                        return [2 /*return*/, {
                                canceled: true,
                                path: null,
                                error: "\"".concat(baseName, "\" \u662F\u6784\u5EFA/\u4F9D\u8D56\u76EE\u5F55\uFF0C\u8BF7\u9009\u62E9\u9879\u76EE\u6839\u76EE\u5F55\u3002"),
                            }];
                    }
                    return [2 /*return*/, { canceled: false, path: realPath }];
            }
        });
    }); });
    // 检查目录是否存在且可访问
    electron_1.ipcMain.handle('fs:verifyDir', function (_event, dirPath) { return __awaiter(_this, void 0, void 0, function () {
        var stat;
        return __generator(this, function (_a) {
            try {
                stat = fs_1.default.statSync(dirPath);
                if (!stat.isDirectory()) {
                    return [2 /*return*/, { valid: false, error: '不是目录' }];
                }
                fs_1.default.readdirSync(dirPath); // 检查权限
                return [2 /*return*/, { valid: true, entries: fs_1.default.readdirSync(dirPath) }];
            }
            catch (err) {
                return [2 /*return*/, { valid: false, error: err.message }];
            }
            return [2 /*return*/];
        });
    }); });
    // 检查路径是否存在
    electron_1.ipcMain.handle('fs:exists', function (_event, dirPath) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, fs_1.default.existsSync(dirPath)];
        });
    }); });
    // 获取路径信息
    electron_1.ipcMain.handle('fs:getPath', function (_event, filePath) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, path_1.default.resolve(filePath)];
        });
    }); });
    // 读取目录
    electron_1.ipcMain.handle('fs:readDir', function (_event, dirPath) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            try {
                return [2 /*return*/, fs_1.default.readdirSync(dirPath)];
            }
            catch (err) {
                return [2 /*return*/, { error: err.message }];
            }
            return [2 /*return*/];
        });
    }); });
    // 获取后端 WS 端口
    electron_1.ipcMain.handle('app:getWsPort', function () { return WS_PORT; });
    // 获取应用信息
    electron_1.ipcMain.handle('app:getInfo', function () { return ({
        version: electron_1.app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        isPackaged: electron_1.app.isPackaged,
    }); });
}
// ─── 生命周期 ───
electron_1.app.whenReady().then(function () {
    registerIpcHandlers();
    // 开发模式下后端由 dev.sh 管理，生产模式下由 Electron 启动
    if (!isDev) {
        startDaemon();
    }
    createWindow();
    electron_1.app.on('activate', function () {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', function () {
    if (daemonProcess) {
        daemonProcess.kill();
        daemonProcess = null;
    }
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('second-instance', function () {
    if (mainWindow) {
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.focus();
    }
});
electron_1.app.on('before-quit', function () {
    if (daemonProcess) {
        daemonProcess.kill();
        daemonProcess = null;
    }
});
