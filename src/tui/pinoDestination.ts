import { Writable } from 'stream';

import type { ProxyStore } from './store.ts';

function levelToString(level: number): string {
  if (level <= 10) {
    return 'trace';
  }
  if (level <= 20) {
    return 'debug';
  }
  if (level <= 30) {
    return 'info';
  }
  if (level <= 40) {
    return 'warn';
  }
  if (level <= 50) {
    return 'error';
  }
  return 'fatal';
}

interface PinoLogEntry {
  time?: number;
  level: number;
  msg?: string;
}

export function createStoreDestination(store: ProxyStore): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        const line = (chunk as Buffer).toString().trim();
        if (!line) {
          callback();
          return;
        }
        const parsed = JSON.parse(line) as PinoLogEntry;
        store.addLog({
          timestamp: parsed.time || Date.now(),
          level: levelToString(parsed.level),
          message: parsed.msg || '',
          data: parsed as unknown as Record<string, unknown>,
        });
      } catch {
        store.addLog({
          timestamp: Date.now(),
          level: 'info',
          message: (chunk as Buffer).toString().trim(),
        });
      }
      callback();
    },
  });
}
