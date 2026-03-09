import http from 'http';
import https from 'https';

async function checkPort(
  port: number,
  hostname: string,
  requestModule: typeof http | typeof https,
) {
  return new Promise((resolve) => {
    const options = {
      hostname,
      port: port,
      path: '/',
      method: 'OPTIONS',
      timeout: 1000,
    };

    const req = requestModule.request(options, () => {
      // A successful response means there's likely a server there.
      resolve(true);
    });

    req.on('error', () => {
      // On error, we assume the server is not there or not accessible.
      resolve(false);
    });

    req.end();
  });
}

async function isHttpsServer(port: number, hostname: string) {
  return checkPort(port, hostname, https);
}

async function isHttpServer(port: number, hostname: string) {
  return checkPort(port, hostname, http);
}

export async function getServerType(
  port: number,
  hostname = 'localhost',
): Promise<'https' | 'http' | undefined> {
  const isHttps = await isHttpsServer(port, hostname);
  if (isHttps) {
    return 'https';
  }
  const isHttp = await isHttpServer(port, hostname);
  if (isHttp) {
    return 'http';
  }
  return undefined;
}
