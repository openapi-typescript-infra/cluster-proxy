export interface CapturedRequest {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  fullHost: string;
  protocol: 'http' | 'https';
  requestHeaders: Record<string, string | string[] | undefined>;
  requestBody: Buffer | null;
  requestBodyTruncated: boolean;
  statusCode: number | null;
  responseHeaders: Record<string, string | string[] | undefined> | null;
  responseBody: Buffer | null;
  responseBodyTruncated: boolean;
  duration: number | null;
  target: string;
  isRegistered: boolean;
  error: string | null;
}

export interface SeenHost {
  host: string;
  fullHost: string;
  firstSeen: number;
  lastSeen: number;
  requestCount: number;
  isRegistered: boolean;
}

export interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface RegistryEntry {
  name: string;
  target: string;
}

export type ViewMode = 'dashboard' | 'inspector';
