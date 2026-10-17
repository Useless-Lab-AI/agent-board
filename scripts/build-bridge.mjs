import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const isWin = process.platform === 'win32';
const exeName = isWin ? 'agent-board-bridge.exe' : 'agent-board-bridge';
const projectRoot = path.resolve(import.meta.dirname, '..');
const bridgeDir = path.join(projectRoot, 'bridge');
const distBinDir = path.join(projectRoot, 'dist', 'bin');
const targetBinary = path.join(distBinDir, exeName);

const args = process.argv.slice(2);
const shouldInstall = args.includes('--install');

function findGo() {
  // 1. Try standard command in PATH
  try {
    const res = spawnSync(isWin ? 'where.exe' : 'which', ['go'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) {
      const firstLine = res.stdout.trim().split(/\r?\n/)[0];
      if (fs.existsSync(firstLine)) return firstLine;
    }
  } catch {}

  // 2. Try common installation locations on Windows
  if (isWin) {
    const commonPaths = [
      'D:\\Program Files\\Go\\bin\\go.exe',
      'C:\\Program Files\\Go\\bin\\go.exe',
      path.join(process.env.USERPROFILE || '', 'go', 'bin', 'go.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Go', 'bin', 'go.exe'),
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

function updateVsCodeSettings(bridgePath) {
  if (!isWin) return;
  const appData = process.env.APPDATA;
  if (!appData) return;
  const settingsPath = path.join(appData, 'Code', 'User', 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(content);
      if (settings['claudeCode.claudeProcessWrapper'] !== bridgePath) {
        settings['claudeCode.claudeProcessWrapper'] = bridgePath;
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
        console.log(`[build-bridge] ✓ Updated VS Code settings: claudeCode.claudeProcessWrapper = ${bridgePath}`);
      } else {
        console.log(`[build-bridge] ✓ VS Code settings already configured with ${bridgePath}`);
      }
    }
  } catch (err) {
    console.warn(`[build-bridge] Note: Could not automatically update VS Code settings.json:`, err);
  }
}

function patchVsCodeClaudeExtension() {
  const vscodeExtDir = path.join(os.homedir(), '.vscode', 'extensions');
  if (!fs.existsSync(vscodeExtDir)) return;
  try {
    const entries = fs.readdirSync(vscodeExtDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('anthropic.claude-code-')) continue;
      const extRoot = path.join(vscodeExtDir, entry.name);
      const webviewPath = path.join(extRoot, 'webview', 'index.js');
      const extJsPath = path.join(extRoot, 'extension.js');

      if (fs.existsSync(webviewPath)) {
        if (!fs.existsSync(`${webviewPath}.bak`)) {
          fs.copyFileSync(webviewPath, `${webviewPath}.bak`);
        }
        let w = fs.readFileSync(`${webviewPath}.bak`, 'utf8');
        let patched = false;

        const t1 = `loadFromServer($){if(this.loadingPromise)return this.loadingPromise;if(this.loadFailed.peek()){if(!$?.retry)return Promise.resolve();if(this.loadFailed.value=!1,this.error.peek()===Vm)this.error.value=void 0}this.isLoading.value=!0;`;
        const r1 = `loadFromServer($){if(this.loadingPromise&&(!$?.force||this.isLoading.peek()))return this.loadingPromise;if(this.loadFailed.peek()){if(!$?.retry&&!$?.force)return Promise.resolve();if(this.loadFailed.value=!1,this.error.peek()===Vm)this.error.value=void 0}if(!$?.silent)this.isLoading.value=!0;`;
        if (w.includes(t1)) {
          w = w.replace(t1, r1);
          patched = true;
        }

        const t2 = `else{let H=Math.min(this.replayInsertIndex,Y.length),W=xS1($),B=W||this.localTurnStarted||this.turnHadToolRound?Y.length:H,K=$H($,{foldedIntoTurn:W&&this.busy.value&&this.turnHadReplyFrame});if(K){if(Y.splice(B,0,K),B===H)this.replayInsertIndex=B+1}if(!$.isSynthetic&&o91($.message.content))this.clearReplayedQuestion()}`;
        const r2 = `else{if(!$.isSynthetic)this.busy.value=!0,this.localTurnStarted=!0,this.lastModifiedTime.value=Date.now();let H=Math.min(this.replayInsertIndex,Y.length),W=xS1($),B=W||this.localTurnStarted||this.turnHadToolRound?Y.length:H,K=$H($,{foldedIntoTurn:W&&this.busy.value&&this.turnHadReplyFrame});if(K){if(Y.splice(B,0,K),B===H||this.localTurnStarted)this.replayInsertIndex=Y.length}if(!$.isSynthetic&&o91($.message.content))this.clearReplayedQuestion()}`;
        if (w.includes(t2)) {
          w = w.replace(t2, r2);
          patched = true;
        }

        const t2b = `else if($.type==="result")this.endTurn()}`;
        const r2b = `else if($.type==="result")this.lastModifiedTime.value=Date.now(),this.endTurn()}`;
        if (w.includes(t2b)) {
          w = w.replace(t2b, r2b);
          patched = true;
        }

        const t3 = `if(A.lastActivity!==void 0)j.advanceActivityTime(A.lastActivity);continue`;
        const r3 = `if(A.lastActivity!==void 0){let _n=A.lastActivity>j.lastModifiedTime.value+1500;if(j.advanceActivityTime(A.lastActivity),(_n||!j.hasOpenChannel())&&!j.busy.value&&(j===this.activeSession.value||j.messages.value.length>0))j.loadFromServer({force:!0,silent:j.messages.value.length>0})}continue`;
        if (w.includes(t3)) {
          w = w.replace(t3, r3);
          patched = true;
        }

        const t4 = `w5(()=>{let V=this.activeConnection.value,U=V?.sessionStoreChanges.value??0;if(!V||U===0)return;t9(()=>{this.listSessionsAfterInFlight("store_sync")})});`;
        const r4 = `w5(()=>{let V=this.activeConnection.value,U=V?.sessionStoreChanges.value??0;if(!V||U===0)return;t9(()=>{this.listSessionsAfterInFlight("store_sync")})});setInterval(()=>{if(this.activeConnection.value&&!this.activeSession.value?.busy.value)this.listSessionsAfterInFlight("store_sync")},3500);window.addEventListener("focus",()=>{if(this.activeConnection.value&&!this.activeSession.value?.busy.value)this.listSessionsAfterInFlight("store_sync")});`;
        if (w.includes(t4)) {
          w = w.replace(t4, r4);
          patched = true;
        }

        if (patched) {
          fs.writeFileSync(webviewPath, w, 'utf8');
          console.log(`[build-bridge] ✓ Patched VS Code Claude webview for live & disk session sync: ${entry.name}`);
        }
      }

      if (fs.existsSync(extJsPath)) {
        if (!fs.existsSync(`${extJsPath}.bak`)) {
          fs.copyFileSync(extJsPath, `${extJsPath}.bak`);
        }
        let e = fs.readFileSync(`${extJsPath}.bak`, 'utf8');
        const te1 = `case"webview_focused":return this.onWebviewFocused?.(),{type:"webview_focused_response"};`;
        const re1 = `case"webview_focused":return this.onWebviewFocused?.(),this.sendSessionStoreChanged(),{type:"webview_focused_response"};`;
        if (e.includes(te1)) {
          e = e.replace(te1, re1);
          fs.writeFileSync(extJsPath, e, 'utf8');
          console.log(`[build-bridge] ✓ Patched VS Code Claude extension host for focus sync: ${entry.name}`);
        }
      }
    }
  } catch (err) {
    console.warn(`[build-bridge] Note: Could not patch VS Code Claude extension:`, err);
  }
}

async function main() {
  console.log('[build-bridge] Starting Go bridge build...');

  if (!fs.existsSync(distBinDir)) {
    fs.mkdirSync(distBinDir, { recursive: true });
  }

  const goExe = findGo();
  if (!goExe) {
    if (fs.existsSync(targetBinary)) {
      console.log(`[build-bridge] Go compiler not found, but prebuilt binary exists at: ${targetBinary}`);
    } else {
      console.warn(`[build-bridge] ⚠️  Go compiler (go.exe) not found in PATH or standard directories.`);
      console.warn(`[build-bridge] Please install Go (https://go.dev) or provide a prebuilt ${exeName} in dist/bin/.`);
    }
    return;
  }

  console.log(`[build-bridge] Found Go compiler at: ${goExe}`);
  try {
    if (process.platform === 'darwin') {
      const armBin = `${targetBinary}.arm64`;
      const amdBin = `${targetBinary}.amd64`;
      execSync(`"${goExe}" build -trimpath -ldflags="-s -w" -o "${armBin}" .`, {
        cwd: bridgeDir,
        stdio: 'inherit',
        env: { ...process.env, GOOS: 'darwin', GOARCH: 'arm64', CGO_ENABLED: '0' },
      });
      execSync(`"${goExe}" build -trimpath -ldflags="-s -w" -o "${amdBin}" .`, {
        cwd: bridgeDir,
        stdio: 'inherit',
        env: { ...process.env, GOOS: 'darwin', GOARCH: 'amd64', CGO_ENABLED: '0' },
      });
      execSync(`lipo -create -output "${targetBinary}" "${armBin}" "${amdBin}"`, {
        stdio: 'inherit',
      });
      fs.unlinkSync(armBin);
      fs.unlinkSync(amdBin);
      fs.chmodSync(targetBinary, 0o755);
    } else {
      execSync(`"${goExe}" build -trimpath -ldflags="-s -w" -o "${targetBinary}" .`, {
        cwd: bridgeDir,
        stdio: 'inherit',
        env: process.env,
      });
    }
    console.log(`[build-bridge] ✓ Successfully built: ${targetBinary} (${(fs.statSync(targetBinary).size / (1024 * 1024)).toFixed(2)} MB)`);
  } catch (err) {
    console.error(`[build-bridge] Failed to build Go bridge:`, err);
    process.exit(1);
  }

  // Copy to ~/.claude/ for local machine use
  const claudeHome = path.join(os.homedir(), '.claude');
  if (fs.existsSync(claudeHome) || shouldInstall) {
    try {
      if (!fs.existsSync(claudeHome)) fs.mkdirSync(claudeHome, { recursive: true });
      const bridgesDir = path.join(claudeHome, 'agent-board-bridges');
      if (!fs.existsSync(bridgesDir)) fs.mkdirSync(bridgesDir, { recursive: true });

      const copySafe = (dest) => {
        try {
          fs.copyFileSync(targetBinary, dest);
        } catch {
          let oldPath = `${dest}.old`;
          try {
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          } catch {
            oldPath = `${dest}.old.${Date.now()}`;
          }
          if (fs.existsSync(dest)) {
            fs.renameSync(dest, oldPath);
          }
          fs.copyFileSync(targetBinary, dest);
        }
      };

      const userTarget = path.join(claudeHome, exeName);
      copySafe(userTarget);
      console.log(`[build-bridge] ✓ Installed to user Claude home: ${userTarget}`);

      const legacyWrapperTarget = path.join(claudeHome, isWin ? 'agent-board-wrapper.exe' : 'agent-board-wrapper');
      copySafe(legacyWrapperTarget);
      console.log(`[build-bridge] ✓ Synced legacy wrapper path: ${legacyWrapperTarget}`);

      if (shouldInstall) {
        updateVsCodeSettings(userTarget);
      }
      patchVsCodeClaudeExtension();
    } catch (e) {
      console.warn(`[build-bridge] Warning: Could not copy to user Claude directory:`, e);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
