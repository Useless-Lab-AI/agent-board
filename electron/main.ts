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
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

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

const GITHUB_REPO = 'Useless-Lab-AI/agent-board';
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

export interface AppUpdateState {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  downloadUrl: string | null;
  progressPercent: number | null;
  error: string | null;
}

const updateState: AppUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  releaseUrl: GITHUB_RELEASES_URL,
  downloadUrl: null,
  progressPercent: null,
  error: null,
};

let downloadedInstallerPath: string | null = null;
let usedNativeUpdater = false;
let notifiedUpdateVersion: string | null = null;
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;

function broadcastUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:update-state', { ...updateState });
  }
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

function setupNativeAutoUpdater() {
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // Allow unsigned NSIS updates on Windows
    (autoUpdater as any).verifyUpdateCodeSignature = false;

    (autoUpdater as any).on('before-quit-for-update', () => {
      isQuitting = true;
    });

    autoUpdater.on('download-progress', (info) => {
      updateState.status = 'downloading';
      updateState.progressPercent = Math.max(0, Math.min(100, Math.round(info.percent || 0)));
      broadcastUpdateState();
    });

    autoUpdater.on('update-downloaded', () => {
      usedNativeUpdater = true;
      updateState.status = 'downloaded';
      updateState.progressPercent = 100;
      updateState.error = null;
      broadcastUpdateState();
    });
  } catch (err) {
    console.warn('[Agent Board Desktop] autoUpdater init warning:', err);
  }
}

async function checkForAppUpdates(manual = false): Promise<AppUpdateState> {
  if (updateState.status === 'checking' || updateState.status === 'downloading') {
    return { ...updateState };
  }

  updateState.currentVersion = app.getVersion();
  updateState.status = 'checking';
  updateState.error = null;
  broadcastUpdateState();

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Agent-Board/${updateState.currentVersion}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`GitHub Releases HTTP ${res.status}`);
    }

    const release = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };

    const latestVersion =
      String(release.tag_name ?? '')
        .replace(/^v/i, '')
        .trim() || updateState.currentVersion;
    const releaseUrl = release.html_url || GITHUB_RELEASES_URL;

    let downloadUrl: string | null = null;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const plat = process.platform;
    const arch = process.arch;

    for (const a of assets) {
      const name = String(a.name ?? '').toLowerCase();
      const dl = a.browser_download_url ?? null;
      if (!dl || name.endsWith('.blockmap') || name.endsWith('.yml') || name.endsWith('.txt')) {
        continue;
      }
      if (plat === 'win32' && name.endsWith('.exe')) {
        downloadUrl = dl;
        break;
      }
      if (plat === 'darwin' && name.endsWith('.dmg')) {
        if ((arch === 'arm64' && name.includes('arm64')) || (arch !== 'arm64' && name.includes('x64'))) {
          downloadUrl = dl;
          break;
        }
        if (!downloadUrl) downloadUrl = dl;
      }
      if (plat === 'linux' && (name.endsWith('.appimage') || name.endsWith('.deb'))) {
        if (name.endsWith('.appimage')) {
          downloadUrl = dl;
          break;
        }
        if (!downloadUrl) downloadUrl = dl;
      }
    }

    updateState.latestVersion = latestVersion;
    updateState.releaseUrl = releaseUrl;
    updateState.downloadUrl = downloadUrl;

    if (compareSemver(latestVersion, updateState.currentVersion) > 0) {
      updateState.status = 'available';
      broadcastUpdateState();

      if (Notification.isSupported() && (manual || notifiedUpdateVersion !== latestVersion)) {
        notifiedUpdateVersion = latestVersion;
        const n = new Notification({
          title: `Agent Board 发现新版本 v${latestVersion}`,
          body: `当前版本 v${updateState.currentVersion}，点击打开看板即可一键下载升级。`,
          icon: getIconPath() || undefined,
        });
        n.on('click', () => showMainWindow());
        n.show();
      }
    } else {
      updateState.status = 'not-available';
      broadcastUpdateState();

      if (manual && Notification.isSupported()) {
        new Notification({
          title: 'Agent Board 已是最新版本',
          body: `当前版本 v${updateState.currentVersion} 已是最新发布的版本。`,
          icon: getIconPath() || undefined,
        }).show();
      }
    }
  } catch (err) {
    updateState.status = manual ? 'error' : 'idle';
    updateState.error = (err as Error).message || String(err);
    broadcastUpdateState();
    if (manual && Notification.isSupported()) {
      new Notification({
        title: '检查更新失败',
        body: updateState.error,
        icon: getIconPath() || undefined,
      }).show();
    }
  }

  return { ...updateState };
}

function downloadFileWithProgress(urlStr: string, destPath: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft < 0) {
      reject(new Error('Too many redirects while downloading update installer'));
      return;
    }
    const client = urlStr.startsWith('https:') ? https : http;
    const req = client.get(
      urlStr,
      {
        headers: {
          'User-Agent': `Agent-Board/${updateState.currentVersion}`,
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          downloadFileWithProgress(nextUrl, destPath, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = Number(res.headers['content-length'] ?? 0);
        let receivedBytes = 0;
        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.max(1, Math.min(99, Math.round((receivedBytes / totalBytes) * 100)));
            if (pct !== updateState.progressPercent) {
              updateState.progressPercent = pct;
              broadcastUpdateState();
            }
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(destPath));
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      },
    );

    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function startAppUpdate(): Promise<AppUpdateState> {
  if (updateState.status === 'downloading') {
    return { ...updateState };
  }

  updateState.status = 'downloading';
  updateState.progressPercent = 0;
  updateState.error = null;
  usedNativeUpdater = false;
  downloadedInstallerPath = null;
  broadcastUpdateState();

  // Strategy 1: Native electron-updater on packaged Windows / Linux AppImage
  if (app.isPackaged && (process.platform === 'win32' || process.platform === 'linux')) {
    try {
      const checkRes = await autoUpdater.checkForUpdates();
      if (checkRes && checkRes.updateInfo && compareSemver(checkRes.updateInfo.version, updateState.currentVersion) > 0) {
        await autoUpdater.downloadUpdate();
        usedNativeUpdater = true;
        updateState.status = 'downloaded';
        updateState.progressPercent = 100;
        broadcastUpdateState();
        return { ...updateState };
      }
    } catch (nativeErr) {
      console.warn('[Agent Board Desktop] electron-updater fallback to direct installer download:', nativeErr);
    }
  }

  // Strategy 2: Direct installer download from GitHub Release asset with live progress
  if (updateState.downloadUrl) {
    try {
      const parsedUrl = new URL(updateState.downloadUrl);
      const fileName = path.basename(parsedUrl.pathname) || `Agent-Board-${updateState.latestVersion || 'latest'}-installer.exe`;
      const destPath = path.join(app.getPath('temp'), fileName);
      await downloadFileWithProgress(updateState.downloadUrl, destPath);
      downloadedInstallerPath = destPath;
      usedNativeUpdater = false;
      updateState.status = 'downloaded';
      updateState.progressPercent = 100;
      updateState.error = null;
      broadcastUpdateState();
      return { ...updateState };
    } catch (dlErr) {
      updateState.status = 'error';
      updateState.error = (dlErr as Error).message || String(dlErr);
      broadcastUpdateState();
      return { ...updateState };
    }
  }

  // Strategy 3: Open release page in browser if no direct installer asset found
  await shell.openExternal(updateState.releaseUrl);
  updateState.status = 'available';
  broadcastUpdateState();
  return { ...updateState };
}

async function installAppUpdate(): Promise<void> {
  if (usedNativeUpdater) {
    isQuitting = true;
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return;
  }

  if (downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
    isQuitting = true;
    await shell.openPath(downloadedInstallerPath);
    if (process.platform === 'win32') {
      setTimeout(() => {
        app.quit();
      }, 600);
    }
    return;
  }

  await shell.openExternal(updateState.downloadUrl || updateState.releaseUrl);
}

function createTray() {
  try {
    const trayIcon = getTrayIcon();
    if (trayIcon.isEmpty()) {
      return;
    }
    tray = new Tray(trayIcon);
    tray.setToolTip(`Agent Board v${app.getVersion()} · 会话看板`);

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
        label: '🔄 检查更新 (Check for Updates…)',
        click: () => {
          showMainWindow();
          void checkForAppUpdates(true);
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
              {
                label: '检查更新… (Check for Updates…)',
                click: () => void checkForAppUpdates(true),
              },
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
          label: '检查更新… (Check for Updates…)',
          click: () => void checkForAppUpdates(true),
        },
        { type: 'separator' },
        {
          label: '在浏览器中打开 (Open in Browser)',
          click: () => shell.openExternal(`http://127.0.0.1:${activePort}`),
        },
        {
          label: 'GitHub 仓库 (Repository)',
          click: () => shell.openExternal(`https://github.com/${GITHUB_REPO}`),
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
    broadcastUpdateState();
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
ipcMain.handle('desktop:get-update-state', () => ({ ...updateState }));
ipcMain.handle('desktop:check-updates', (_e, manual = false) => checkForAppUpdates(Boolean(manual)));
ipcMain.handle('desktop:start-update', () => startAppUpdate());
ipcMain.handle('desktop:install-update', () => installAppUpdate());

app.on('second-instance', () => {
  showMainWindow();
});

app.on('activate', () => {
  showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowBounds();
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (sseReq) sseReq.destroy();
  if (serverChild) {
    serverChild.kill();
    serverChild = null;
  }
});

app.whenReady().then(async () => {
  setupNativeAutoUpdater();
  setupApplicationMenu();
  createTray();
  ensureBridgeInstalled(false);

  try {
    await startServer();
    showMainWindow();
    connectEventStream();

    // Check for updates 6s after startup and every 4 hours thereafter
    setTimeout(() => {
      void checkForAppUpdates(false);
    }, 6000);
    updateCheckTimer = setInterval(
      () => {
        void checkForAppUpdates(false);
      },
      4 * 60 * 60 * 1000,
    );
  } catch (err) {
    console.error('[Agent Board Desktop] Startup error:', err);
    app.quit();
  }
});

