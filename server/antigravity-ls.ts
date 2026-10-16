import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AntigravityCredentials {
  address: string;
  csrfToken: string;
}

let cachedCredentials: AntigravityCredentials | null = null;
let lastCheckTime = 0;
let inflightPromise: Promise<AntigravityCredentials | null> | null = null;
const CACHE_TTL_MS = 120_000;

async function probeHttpPort(port: number, token: string): Promise<boolean> {
  const body = JSON.stringify({
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      locale: 'en',
    },
  });

  return new Promise<boolean>((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': token,
        },
        timeout: 1500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

async function discoverCredentialsInternal(
  runnerExe?: string,
): Promise<AntigravityCredentials | null> {
  const now = Date.now();

  try {
    if (process.platform === 'win32') {
      let pid = '';
      let token = '';

      // Try PowerShell CimInstance first (fast & supported on modern Windows 11 where wmic is deprecated)
      try {
        const psCmd = `Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;
        const { stdout: psOut } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psCmd],
          { timeout: 8000, windowsHide: true },
        );
        for (const rawLine of psOut.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          const sepIdx = line.indexOf('|');
          if (sepIdx <= 0) continue;
          const candidatePid = line.slice(0, sepIdx).trim();
          const cmdLine = line.slice(sepIdx + 1);
          const tokenMatch = cmdLine.match(/--csrf_token(?:=|\s+)([^\s\r\n"']+)/i);
          if (candidatePid && tokenMatch) {
            pid = candidatePid;
            token = tokenMatch[1];
            break;
          }
        }
      } catch {
        // Fallback to wmic on older Windows environments
      }

      if (!pid || !token) {
        try {
          const { stdout: wmicOut } = await execFileAsync(
            'wmic',
            [
              'process',
              'where',
              "name='language_server.exe'",
              'get',
              'ProcessId,CommandLine',
              '/format:list',
            ],
            { timeout: 8000, windowsHide: true },
          );
          const pidMatch = wmicOut.match(/ProcessId=(\d+)/i);
          const tokenMatch = wmicOut.match(/--csrf_token(?:=|\s+)([^\s\r\n"']+)/i);
          if (pidMatch && tokenMatch) {
            pid = pidMatch[1];
            token = tokenMatch[1];
          }
        } catch {}
      }

      if (pid && token) {
        const { stdout: netstatOut } = await execFileAsync('netstat', ['-ano'], {
          timeout: 5000,
          windowsHide: true,
        });

        const portRegex = new RegExp(
          `TCP\\s+127\\.0\\.0\\.1:(\\d+)\\s+0\\.0\\.0\\.0:0\\s+LISTENING\\s+${pid}\\b`,
          'g',
        );
        const ports: number[] = [];
        let m: RegExpExecArray | null;
        while ((m = portRegex.exec(netstatOut)) !== null) {
          const p = Number(m[1]);
          if (!ports.includes(p)) ports.push(p);
        }

        // Sort ports descending (HTTP/gRPC Connect port is typically the higher port)
        ports.sort((a, b) => b - a);

        // 1. Probe HTTP Connect endpoint directly (fast & reliable across all callers)
        for (const port of ports) {
          if (await probeHttpPort(port, token)) {
            cachedCredentials = { address: `localhost:${port}`, csrfToken: token };
            lastCheckTime = Date.now();
            return cachedCredentials;
          }
        }

        // 2. Fallback to CLI probe if runnerExe is provided
        for (const port of ports) {
          const testAddr = `localhost:${port}`;
          if (!runnerExe) {
            cachedCredentials = { address: testAddr, csrfToken: token };
            lastCheckTime = now;
            return cachedCredentials;
          }

          try {
            const { stdout: testOut } = await execFileAsync(
              runnerExe,
              ['agentapi', 'get-conversation-metadata', 'probe-test'],
              {
                timeout: 2000,
                windowsHide: true,
                env: {
                  ...process.env,
                  ANTIGRAVITY_LS_ADDRESS: testAddr,
                  ANTIGRAVITY_CSRF_TOKEN: token,
                },
              },
            );

            if (
              testOut.includes('conversationMetadata') ||
              testOut.includes('NotFound') ||
              testOut.includes('not found') ||
              testOut.includes('PermissionDenied') ||
              testOut.includes('InvalidArgument') ||
              testOut.includes('response')
            ) {
              cachedCredentials = { address: testAddr, csrfToken: token };
              lastCheckTime = Date.now();
              return cachedCredentials;
            }
          } catch (e: any) {
            const out = String(e?.stdout ?? '');
            if (out && !out.includes('Unavailable') && !out.includes('EOF')) {
              cachedCredentials = { address: testAddr, csrfToken: token };
              lastCheckTime = Date.now();
              return cachedCredentials;
            }
          }
        }
      }
    } else {
      // macOS / Linux process inspection
      const { stdout: psOut } = await execFileAsync('ps', ['-eo', 'pid,args'], {
        timeout: 3000,
      });
      const lines = psOut.split('\n');
      for (const line of lines) {
        if (line.includes('language_server') && line.includes('--csrf_token')) {
          const tokenMatch = line.match(/--csrf_token(?:=|\s+)([^\s]+)/);
          const pidMatch = line.trim().match(/^(\d+)/);
          if (tokenMatch && pidMatch) {
            const pid = pidMatch[1];
            const token = tokenMatch[1];

            try {
              const { stdout: lsofOut } = await execFileAsync(
                'lsof',
                ['-Pan', '-p', pid, '-i', 'TCP', '-sTCP:LISTEN'],
                { timeout: 3000 },
              );
              const portMatches = [...lsofOut.matchAll(/:(\d+)\s+\(LISTEN\)/g)];
              const ports = portMatches.map((pm) => Number(pm[1])).sort((a, b) => b - a);

              for (const port of ports) {
                if (await probeHttpPort(port, token)) {
                  cachedCredentials = { address: `localhost:${port}`, csrfToken: token };
                  lastCheckTime = Date.now();
                  return cachedCredentials;
                }
              }

              if (ports.length > 0) {
                cachedCredentials = {
                  address: `localhost:${ports[0]}`,
                  csrfToken: token,
                };
                lastCheckTime = Date.now();
                return cachedCredentials;
              }
            } catch {}
          }
        }
      }
    }
  } catch {
    // Discovery failed or unsupported environment
  }

  return null;
}

export async function resolveAntigravityCredentials(
  runnerExe?: string,
): Promise<AntigravityCredentials | null> {
  // 1. If explicit environment variables already set (e.g. running inside Antigravity terminal)
  if (process.env.ANTIGRAVITY_LS_ADDRESS && process.env.ANTIGRAVITY_CSRF_TOKEN) {
    return {
      address: process.env.ANTIGRAVITY_LS_ADDRESS,
      csrfToken: process.env.ANTIGRAVITY_CSRF_TOKEN,
    };
  }

  // 2. Check cached credentials
  const now = Date.now();
  if (cachedCredentials && now - lastCheckTime < CACHE_TTL_MS) {
    return cachedCredentials;
  }

  // 3. Deduplicate concurrent discovery calls
  if (!inflightPromise) {
    inflightPromise = discoverCredentialsInternal(runnerExe).finally(() => {
      inflightPromise = null;
    });
  }
  return inflightPromise;
}

export function invalidateAntigravityCredentialsCache(): void {
  cachedCredentials = null;
  lastCheckTime = 0;
}
