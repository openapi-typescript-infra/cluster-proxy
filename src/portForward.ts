import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

import type { Logger } from 'pino';
import portfinder from 'portfinder';

export interface PortForwardTarget {
  namespace: string;
  serviceName: string;
  servicePort: number;
  protocol: string;
}

interface ForwardEntry {
  localPort: number;
  process: ChildProcessWithoutNullStreams;
  ready: Promise<URL>;
  lastUsed: number;
}

const IDLE_TTL_MS = 5 * 60 * 1000;

export class PortForwardManager {
  private readonly entries = new Map<string, ForwardEntry>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(private readonly logger: Logger) {
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 60_000);
    this.cleanupTimer.unref();
  }

  async getUrl(target: PortForwardTarget): Promise<URL> {
    const key = this.key(target);
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.ready;
    }

    const localPort = await portfinder.getPortPromise({ port: 10_000 });
    const ready = this.start(target, localPort);
    return ready;
  }

  close() {
    clearInterval(this.cleanupTimer);
    for (const entry of this.entries.values()) {
      entry.process.kill();
    }
    this.entries.clear();
  }

  private start(target: PortForwardTarget, localPort: number): Promise<URL> {
    const key = this.key(target);
    const args = [
      '-n',
      target.namespace,
      'port-forward',
      `service/${target.serviceName}`,
      `${localPort}:${target.servicePort}`,
      '--address',
      '127.0.0.1',
    ];
    const child = spawn('kubectl', args);

    const ready = new Promise<URL>((resolve, reject) => {
      let settled = false;
      let stderr = '';
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        reject(new Error(`Timed out starting kubectl port-forward for ${key}`));
      }, 15_000);

      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        fn();
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        this.logger.debug({ target, output: text.trim() }, 'kubectl port-forward output');
        if (text.includes('Forwarding from 127.0.0.1:')) {
          finish(() => resolve(new URL(`${target.protocol}//127.0.0.1:${localPort}`)));
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (error) => {
        finish(() => reject(error));
      });

      child.on('exit', (code, signal) => {
        this.entries.delete(key);
        if (!settled) {
          finish(() =>
            reject(
              new Error(
                `kubectl port-forward exited for ${key} (${signal ?? code ?? 'unknown'}): ${stderr.trim()}`,
              ),
            ),
          );
        }
      });
    });

    const entry: ForwardEntry = {
      localPort,
      process: child,
      ready,
      lastUsed: Date.now(),
    };
    this.entries.set(key, entry);

    ready.catch(() => {
      this.entries.delete(key);
      child.kill();
    });

    this.logger.info({ target, localPort }, 'Starting kubectl port-forward');
    return ready;
  }

  private cleanupIdle() {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.lastUsed <= IDLE_TTL_MS) {
        continue;
      }
      this.logger.info({ key, localPort: entry.localPort }, 'Stopping idle kubectl port-forward');
      entry.process.kill();
      this.entries.delete(key);
    }
  }

  private key(target: PortForwardTarget) {
    return `${target.namespace}/${target.serviceName}:${target.servicePort}:${target.protocol}`;
  }
}
