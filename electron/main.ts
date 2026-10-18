import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  Notification,
  shell,
  ipcMain,
  utilityProcess,
  type UtilityProcess,
  type NativeImage,
} from 'electron';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Set AppUserModelId for Windows notifications and taskbar grouping
if (process.platform === 'win32') {
  app.setAppUserModelId('com.agentboard.desktop');
}

const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverChild: UtilityProcess | null = null;
let isQuitting = false;
let sseReq: http.ClientRequest | null = null;
let notifiedSessions = new Set<string>();

const DEFAULT_PORT = 4317;
let activePort = Number(process.env.AGENT_BOARD_PORT ?? DEFAULT_PORT);

// Persistent window bounds storage
const boundsFile = path.join(app.getPath('userData'), 'window-bounds.json');

function loadWindowBounds(): { width: number; height: number; x?: number; y?: number; isMaximized?: boolean } {
  try {
    if (fs.existsSync(boundsFile)) {
      return JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
    }
  } catch {
    // fallback to defaults
  }
  return { width: 1400, height: 900 };
}

function saveWindowBounds() {
  if (!mainWindow) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(boundsFile, JSON.stringify({ ...bounds, isMaximized }), 'utf8');
  } catch {
    // ignore write errors
  }
}

function getAppRoot(): string {
  // In packaged app, app.getAppPath() points to app or app.asar
  return app.getAppPath();
}

function getIconPath(): string {
  const root = getAppRoot();
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(root, 'assets', 'icon.ico'),
          path.join(root, 'build', 'icon.ico'),
          path.join(root, 'assets', 'icon.png'),
          path.join(root, 'build', 'icon.png'),
        ]
      : [
          path.join(root, 'assets', 'icon.png'),
          path.join(root, 'build', 'icon.png'),
          path.join(root, 'assets', 'icon.ico'),
          path.join(root, 'build', 'icon.ico'),
        ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return '';
}

function getTrayIcon(): NativeImage {
  const root = getAppRoot();
  if (process.platform === 'win32') {
    for (const rel of [path.join('assets', 'icon.ico'), path.join('build', 'icon.ico')]) {
      const ico = path.join(root, rel);
      if (fs.existsSync(ico)) {
        return nativeImage.createFromPath(ico);
      }
    }
  }
  const candidates = [
    path.join(root, 'assets', 'tray.png'),
    path.join(root, 'build', 'tray.png'),
    path.join(root, 'assets', 'icon.png'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const img = nativeImage.createFromPath(c);
      if (process.platform === 'darwin') {
        img.setTemplateImage(true);
      }
      return img;
    }
  }
  return nativeImage.createEmpty();
}

async function isServerReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/sessions`,
      { timeout: 1000 },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startServer(): Promise<number> {
  const ready = await isServerReady(activePort);
  if (ready) {
    console.log(`[Agent Board Desktop] Reusing running server on port ${activePort}`);
    return activePort;
  }

  const root = getAppRoot();
  const serverScript = path.join(root, 'dist', 'server', 'api.js');
  const webDir = path.join(root, 'dist', 'web');

  if (!fs.existsSync(serverScript)) {
    throw new Error(`Server script not found at ${serverScript}. Please run npm run build first.`);
  }

  console.log(`[Agent Board Desktop] Spawning server utility process on port ${activePort}...`);
  serverChild = utilityProcess.fork(serverScript, [], {
    env: {
      ...process.env,
      AGENT_BOARD_PORT: String(activePort),
      AGENT_BOARD_WEB_DIR: webDir,
    },
    stdio: 'pipe',
  });

  serverChild.stdout?.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log(`[Server] ${text}`);
  });

  serverChild.stderr?.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.error(`[Server Error] ${text}`);
  });

  serverChild.on('exit', (code) => {
    console.log(`[Server] exited with code ${code}`);
    serverChild = null;
  });

  // Poll until ready
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isServerReady(activePort)) {
      console.log(`[Agent Board Desktop] Server is ready on port ${activePort}`);
      return activePort;
    }
  }

  throw new Error(`Server failed to start on port ${activePort} within 10 seconds.`);
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'win32') {
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(false);
  }
}

function connectEventStream() {
  if (sseReq) {
    sseReq.destroy();
    sseReq = null;
  }

  sseReq = http.get(`http://127.0.0.1:${activePort}/api/events`, (res) => {
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventType = line.slice(7).trim();
          if (eventType === 'interaction' || eventType === 'change') {
            checkApprovalNotifications();
          }
        }
      }
    });

    res.on('end', () => {
      // Reconnect after 3 seconds if not quitting
      if (!isQuitting) {
        setTimeout(connectEventStream, 3000);
      }
    });
  });

  sseReq.on('error', () => {
    if (!isQuitting) {
      setTimeout(connectEventStream, 5000);
    }
  });
}

function checkApprovalNotifications() {
  http.get(`http://127.0.0.1:${activePort}/api/sessions`, (res) => {
    if (res.statusCode !== 200) return;
    let raw = '';
    res.on('data', (c) => (raw += c));
    res.on('end', () => {
      try {
        const data = JSON.parse(raw);
        const sessions: Array<{ id: string; title: string; execution: string; stateReason?: string }> =
          data.sessions ?? [];

        const activeApprovalIds = new Set<string>();

        for (const s of sessions) {
          if (s.execution === 'WAITING_APPROVAL' || s.execution === 'WAITING_INPUT') {
            activeApprovalIds.add(s.id);
            if (!notifiedSessions.has(s.id)) {
              notifiedSessions.add(s.id);
              if (Notification.isSupported()) {
                const n = new Notification({
                  title: 'Agent Board · 等待审批',
                  body: `${s.title}: ${s.stateReason || '智能体等待人工操作确认'}`,
                  icon: getIconPath() || undefined,
                });
                n.on('click', () => {
                  showMainWindow();
                });
                n.show();
              }
            }
          }
        }

        // Clean up resolved notifications
        for (const id of notifiedSessions) {
          if (!activeApprovalIds.has(id)) {
            notifiedSessions.delete(id);
          }
        }
      } catch {
        // ignore parse error
      }
    });
  }).on('error', () => {});
}

function ensureBridgeInstalled(notifyUser = false) {
  try {
    const isWin = process.platform === 'win32';
    const exeName = isWin ? 'agent-board-bridge.exe' : 'agent-board-bridge';
    const root = getAppRoot();
    const candidates = [
      path.join(process.resourcesPath, 'bin', exeName),
      path.join(root, 'dist', 'bin', exeName),
    ];
    let sourcePath = '';
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        sourcePath = c;
        break;
      }
    }
    if (!sourcePath) {
      if (notifyUser) {
        new Notification({
          title: 'Claude 桥接程序未就绪',
          body: '未在安装包中找到 agent-board-bridge 可执行文件，请先运行 npm run build:bridge 构建。',
        }).show();
      }
      return;
    }

    const home = os.homedir();
    const claudeDir = path.join(home, '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    const bridgesDir = path.join(claudeDir, 'agent-board-bridges');
    if (!fs.existsSync(bridgesDir)) {
      fs.mkdirSync(bridgesDir, { recursive: true });
    }

    const copySafe = (src: string, dest: string) => {
      try {
        fs.copyFileSync(src, dest);
      } catch {
        const oldPath = `${dest}.old`;
        try {
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch {}
        if (fs.existsSync(dest)) {
          fs.renameSync(dest, oldPath);
        }
        fs.copyFileSync(src, dest);
      }
    };

    const targetExe = path.join(claudeDir, exeName);
    let shouldCopy = !fs.existsSync(targetExe);
    if (!shouldCopy) {
      try {
        const sStat = fs.statSync(sourcePath);
        const tStat = fs.statSync(targetExe);
        if (sStat.size !== tStat.size || sStat.mtimeMs > tStat.mtimeMs) shouldCopy = true;
      } catch {}
    }

    if (shouldCopy) {
      copySafe(sourcePath, targetExe);
      console.log(`[Agent Board Desktop] Installed Claude bridge to ${targetExe}`);
    }

    const legacyWrapper = path.join(claudeDir, isWin ? 'agent-board-wrapper.exe' : 'agent-board-wrapper');
    try {
      copySafe(sourcePath, legacyWrapper);
    } catch {}

    let configured = false;
    if (isWin && process.env.APPDATA) {
      const settingsPath = path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        try {
          const content = fs.readFileSync(settingsPath, 'utf8');
          const settings = JSON.parse(content);
          if (settings['claudeCode.claudeProcessWrapper'] !== targetExe) {
            settings['claudeCode.claudeProcessWrapper'] = targetExe;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
            configured = true;
            console.log(`[Agent Board Desktop] Configured claudeCode.claudeProcessWrapper in VS Code settings`);
          } else {
            configured = true;
          }
        } catch {}
      }
    }

    if (notifyUser) {
      new Notification({
        title: 'Claude VS Code 桥接配置成功',
        body: configured
          ? `已成功部署 bridge 到 ~/.claude 并配置 VS Code 设置！在 VS Code 中直接打开 Claude 即可无感双向交互。`
          : `已成功部署 bridge 到: ${targetExe}。`,
      }).show();
    }
  } catch (err) {
    console.warn('[Agent Board Desktop] Note: Could not auto-install bridge:', err);
    if (notifyUser) {
      new Notification({
        title: '配置 Claude 桥接遇到问题',
        body: String(err),
      }).show();
    }
  }
}

function createTray() {
  try {
    const trayIcon = getTrayIcon();
    if (trayIcon.isEmpty()) {
      return;
    }
    tray = new Tray(trayIcon);
    tray.setToolTip('Agent Board · 会话看板');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示看板 (Show Board)',
        click: () => showMainWindow(),
      },
      {
        label: '📱 手机远程控制 (Mobile Remote QR)',
        click: () => {
          showMainWindow();
          mainWindow?.webContents.send('desktop:open-remote-control');
        },
      },
      {
        label: '最小化到托盘 (Hide to Tray)',
        click: () => mainWindow?.hide(),
      },
      { type: 'separator' },
      {
        label: '配置 Claude VS Code 桥接 (Setup Claude Bridge)',
        click: () => ensureBridgeInstalled(true),
      },
      { type: 'separator' },
      {
        label: '刷新会话 (Refresh)',
        click: () => mainWindow?.webContents.reload(),
      },
      {
        label: '在浏览器中打开 (Open in Browser)',
        click: () => shell.openExternal(`http://127.0.0.1:${activePort}`),
      },
      { type: 'separator' },
      {
        label: '退出 (Quit)',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow?.isVisible()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.focus();
        }
      } else {
        showMainWindow();
      }
    });

    tray.on('double-click', () => {
      showMainWindow();
    });
  } catch (err) {
    console.warn('[Agent Board Desktop] Failed to initialize system tray:', err);
  }
}

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              {
                label: '退出 (Quit)',
                accelerator: 'Command+Q',
                click: () => {
                  isQuitting = true;
                  app.quit();
                },
              },
            ],
          },
        ]
      : []),
    {
      label: '编辑 (Edit)',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: '视图 (View)',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: '窗口 (Window)',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      label: '帮助 (Help)',
      submenu: [
        {
          label: '在浏览器中打开 (Open in Browser)',
          click: () => shell.openExternal(`http://127.0.0.1:${activePort}`),
        },
        {
          label: 'GitHub 仓库 (Repository)',
          click: () => shell.openExternal('https://github.com/your-username/agent-board'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const bounds = loadWindowBounds();
  const iconPath = getIconPath();

  const winOptions: any = {
    width: bounds.width,
    height: bounds.height,
    minWidth: 480,
    minHeight: 600,
    title: 'Agent Board · 会话看板',
    backgroundColor: '#0f172a',
    autoHideMenuBar: process.platform !== 'darwin',
    icon: iconPath || undefined,
    show: true,
    center: typeof bounds.x !== 'number' || typeof bounds.y !== 'number',
    webPreferences: {
      preload: path.join(import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  if (typeof bounds.x === 'number' && typeof bounds.y === 'number') {
    winOptions.x = bounds.x;
    winOptions.y = bounds.y;
  }

  mainWindow = new BrowserWindow(winOptions);

  if (bounds.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    console.log('[Agent Board Desktop] Window ready to show, focusing...');
    mainWindow?.show();
    mainWindow?.focus();
    if (process.platform === 'win32') {
      mainWindow?.setAlwaysOnTop(true);
      mainWindow?.setAlwaysOnTop(false);
    }
  });

  const serverUrl = `http://127.0.0.1:${activePort}`;
  console.log(`[Agent Board Desktop] Loading ${serverUrl}...`);
  mainWindow.loadURL(serverUrl);

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Agent Board Desktop] Web page loaded successfully');
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[Agent Board Desktop] Failed to load ${validatedURL}: ${errorCode} (${errorDescription})`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external web links in system browser
    if (url.startsWith('http:') || url.startsWith('https:')) {
      if (!url.startsWith(`http://127.0.0.1:${activePort}`)) {
        void shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      saveWindowBounds();
      mainWindow?.hide();
    }
  });

  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);

  mainWindow.show();
  mainWindow.focus();
}

// IPC handlers from renderer
ipcMain.handle('desktop:open-external', (_e, url: string) => {
  if (typeof url === 'string' && (url.startsWith('http:') || url.startsWith('https:'))) {
    return shell.openExternal(url);
  }
});
ipcMain.handle('desktop:minimize', () => mainWindow?.minimize());
ipcMain.handle('desktop:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('desktop:close', () => mainWindow?.close());

app.on('second-instance', () => {
  showMainWindow();
});

app.on('activate', () => {
  showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowBounds();
  if (sseReq) sseReq.destroy();
  if (serverChild) {
    serverChild.kill();
    serverChild = null;
  }
});

app.whenReady().then(async () => {
  setupApplicationMenu();
  createTray();
  ensureBridgeInstalled(false);

  try {
    await startServer();
    showMainWindow();
    connectEventStream();
  } catch (err) {
    console.error('[Agent Board Desktop] Startup error:', err);
    app.quit();
  }
});
