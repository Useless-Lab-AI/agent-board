import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import type { SessionStore } from './session-store.js';

export interface LanEndpoint {
  name: string;
  address: string;
  url: string;
  kind: 'lan' | 'tailscale' | 'virtual';
}

export interface TunnelState {
  status: 'stopped' | 'starting' | 'running' | 'error';
  url: string | null;
  provider: 'cloudflared' | 'localhost.run' | null;
  error: string | null;
}

export interface RemoteControlStatus {
  enabled: boolean;
  isRemoteClient: boolean;
  deviceName: string;
  port: number;
  lanEndpoints: LanEndpoint[];
  primaryLanUrl: string;
  customUrl: string;
  tunnel: TunnelState;
  token?: string;
}

const VIRTUAL_ADAPTER_RE =
  /vEthernet|WSL|Docker|VMware|VirtualBox|Hyper-V|Loopback|Default Switch|vboxnet|virbr|br-/i;
const TAILSCALE_ADAPTER_RE = /tailscale|utun|wg/i;

function isTailscaleIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  // CGNAT 100.64.0.0/10 used by Tailscale
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function lanPriority(endpoint: LanEndpoint): number {
  if (endpoint.kind === 'lan') {
    if (endpoint.address.startsWith('192.168.')) return 1;
    if (endpoint.address.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(endpoint.address)) return 3;
    return 4;
  }
  if (endpoint.kind === 'tailscale') return 5;
  return 10;
}

export function discoverLanEndpoints(port: number): LanEndpoint[] {
  const interfaces = os.networkInterfaces();
  const all: LanEndpoint[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      const isIPv4 = addr.family === 'IPv4' || (addr.family as unknown) === 4;
      if (!isIPv4 || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue; // link-local

      let kind: LanEndpoint['kind'] = 'lan';
      if (isTailscaleIp(addr.address) || TAILSCALE_ADAPTER_RE.test(name)) {
        kind = 'tailscale';
      } else if (VIRTUAL_ADAPTER_RE.test(name)) {
        kind = 'virtual';
      }

      all.push({
        name,
        address: addr.address,
        url: `http://${addr.address}:${port}`,
        kind,
      });
    }
  }

  all.sort((a, b) => lanPriority(a) - lanPriority(b));
  const nonVirtual = all.filter((item) => item.kind !== 'virtual');
  return nonVirtual.length > 0 ? nonVirtual : all;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function extractRequestToken(req: IncomingMessage, port: number): string | null {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const queryToken = url.searchParams.get('rc') ?? url.searchParams.get('token');
    if (queryToken && queryToken.trim()) return queryToken.trim();
  } catch {}

  const headerToken = req.headers['x-agent-board-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.agent_board_rc) {
    return cookies.agent_board_rc;
  }

  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer) {
    try {
      const refUrl = new URL(referer);
      const refToken = refUrl.searchParams.get('rc') ?? refUrl.searchParams.get('token');
      if (refToken && refToken.trim()) return refToken.trim();
    } catch {}
  }

  return null;
}

export class RemoteControlManager {
  private readonly store: SessionStore;
  private readonly port: number;
  private readonly onChange?: () => void;
  private tunnelProc: ChildProcess | null = null;
  private tunnelState: TunnelState = {
    status: 'stopped',
    url: null,
    provider: null,
    error: null,
  };

  constructor(store: SessionStore, port: number, onChange?: () => void) {
    this.store = store;
    this.port = port;
    this.onChange = onChange;

    if (!this.store.getSetting('remote_control_token')) {
      this.store.setSetting('remote_control_token', randomBytes(24).toString('base64url'));
    }
    if (this.store.getSetting('remote_control_enabled') === undefined) {
      this.store.setSetting('remote_control_enabled', 'true');
    }
    if (!this.store.getSetting('remote_control_device_name')) {
      this.store.setSetting('remote_control_device_name', os.hostname() || 'My Desktop');
    }
  }

  isEnabled(): boolean {
    return this.store.getSetting('remote_control_enabled') !== 'false';
  }

  setEnabled(enabled: boolean): void {
    this.store.setSetting('remote_control_enabled', enabled ? 'true' : 'false');
    if (!enabled) {
      this.stopTunnel();
    }
    this.onChange?.();
  }

  getToken(): string {
    let token = this.store.getSetting('remote_control_token');
    if (!token) {
      token = randomBytes(24).toString('base64url');
      this.store.setSetting('remote_control_token', token);
    }
    return token;
  }

  rotateToken(): string {
    const next = randomBytes(24).toString('base64url');
    this.store.setSetting('remote_control_token', next);
    this.onChange?.();
    return next;
  }

  getDeviceName(): string {
    return this.store.getSetting('remote_control_device_name') || os.hostname() || 'My Desktop';
  }

  setDeviceName(name: string): void {
    const clean = name.trim().slice(0, 64) || os.hostname() || 'My Desktop';
    this.store.setSetting('remote_control_device_name', clean);
    this.onChange?.();
  }

  getCustomUrl(): string {
    return this.store.getSetting('remote_control_custom_url') || '';
  }

  setCustomUrl(url: string): void {
    const clean = url.trim().replace(/\/+$/, '');
    this.store.setSetting('remote_control_custom_url', clean);
    this.onChange?.();
  }

  verifyToken(candidate: string | null | undefined): boolean {
    if (!this.isEnabled() || !candidate) return false;
    const expected = this.getToken();
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  getStatus(isRemoteClient: boolean): RemoteControlStatus {
    const lanEndpoints = discoverLanEndpoints(this.port);
    const primaryLanUrl = lanEndpoints[0]?.url ?? `http://127.0.0.1:${this.port}`;
    return {
      enabled: this.isEnabled(),
      isRemoteClient,
      deviceName: this.getDeviceName(),
      port: this.port,
      lanEndpoints,
      primaryLanUrl,
      customUrl: this.getCustomUrl(),
      tunnel: { ...this.tunnelState },
      ...(isRemoteClient ? {} : { token: this.getToken() }),
    };
  }

  async startTunnel(): Promise<TunnelState> {
    if (this.tunnelState.status === 'running' || this.tunnelState.status === 'starting') {
      return { ...this.tunnelState };
    }
    if (!this.isEnabled()) {
      this.setEnabled(true);
    }

    this.stopTunnel();
    this.tunnelState = {
      status: 'starting',
      url: null,
      provider: null,
      error: null,
    };
    this.onChange?.();

    const cloudflaredAvailable = await this.checkCommandAvailable('cloudflared', ['--version']);
    if (cloudflaredAvailable) {
      return this.launchCloudflared();
    }
    return this.launchLocalhostRun();
  }

  stopTunnel(): TunnelState {
    if (this.tunnelProc) {
      try {
        this.tunnelProc.kill();
      } catch {}
      this.tunnelProc = null;
    }
    this.tunnelState = {
      status: 'stopped',
      url: null,
      provider: null,
      error: null,
    };
    this.onChange?.();
    return { ...this.tunnelState };
  }

  private checkCommandAvailable(cmd: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {}
          resolve(false);
        }, 1500);
        child.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve(code === 0);
        });
      } catch {
        resolve(false);
      }
    });
  }

  private launchCloudflared(): Promise<TunnelState> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve({ ...this.tunnelState });
        }
      };

      const proc = spawn(
        'cloudflared',
        ['tunnel', '--url', `http://127.0.0.1:${this.port}`, '--no-autoupdate'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      this.tunnelProc = proc;
      this.tunnelState.provider = 'cloudflared';

      const handleOutput = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match && this.tunnelState.status !== 'running') {
          this.tunnelState = {
            status: 'running',
            url: match[0],
            provider: 'cloudflared',
            error: null,
          };
          this.onChange?.();
          finish();
        }
      };

      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);

      proc.on('error', (err) => {
        if (this.tunnelProc === proc) {
          this.tunnelProc = null;
          this.tunnelState = {
            status: 'error',
            url: null,
            provider: 'cloudflared',
            error: err.message,
          };
          this.onChange?.();
        }
        finish();
      });

      proc.on('exit', (code) => {
        if (this.tunnelProc === proc) {
          this.tunnelProc = null;
          if (this.tunnelState.status !== 'stopped') {
            this.tunnelState = {
              status: 'error',
              url: null,
              provider: 'cloudflared',
              error: `隧道进程已退出 (code ${code ?? 'unknown'})`,
            };
            this.onChange?.();
          }
        }
        finish();
      });

      setTimeout(() => {
        finish();
      }, 8000);
    });
  }

  private launchLocalhostRun(): Promise<TunnelState> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve({ ...this.tunnelState });
        }
      };

      const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const proc = spawn(
        'ssh',
        [
          '-T',
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          `UserKnownHostsFile=${nullFile}`,
          '-o',
          'ServerAliveInterval=30',
          '-o',
          'ConnectTimeout=8',
          '-o',
          'ExitOnForwardFailure=yes',
          '-R',
          `80:127.0.0.1:${this.port}`,
          'nokey@localhost.run',
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      this.tunnelProc = proc;
      this.tunnelState.provider = 'localhost.run';

      const handleOutput = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const match = text.match(/https:\/\/[a-z0-9-]+\.lhr\.life/i);
        if (match && this.tunnelState.status !== 'running') {
          this.tunnelState = {
            status: 'running',
            url: match[0],
            provider: 'localhost.run',
            error: null,
          };
          this.onChange?.();
          finish();
        }
      };

      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);

      proc.on('error', (err) => {
        if (this.tunnelProc === proc) {
          this.tunnelProc = null;
          this.tunnelState = {
            status: 'error',
            url: null,
            provider: 'localhost.run',
            error: err.message,
          };
          this.onChange?.();
        }
        finish();
      });

      proc.on('exit', (code) => {
        if (this.tunnelProc === proc) {
          this.tunnelProc = null;
          if (this.tunnelState.status !== 'stopped') {
            this.tunnelState = {
              status: 'error',
              url: null,
              provider: 'localhost.run',
              error: `SSH 公网隧道已断开 (code ${code ?? 'unknown'})`,
            };
            this.onChange?.();
          }
        }
        finish();
      });

      setTimeout(() => {
        finish();
      }, 8000);
    });
  }
}
