import dns2 from 'dns2';
import type { Logger } from 'pino';

const { Packet } = dns2;

function matchesZone(name: string, zones: string[]): boolean {
  const lower = name.toLowerCase().replace(/\.$/, '');
  return zones.some((zone) => lower === zone || lower.endsWith(`.${zone}`));
}

export async function createDns({
  host,
  dnsPort,
  resolveAddress,
  zones,
  logger,
}: {
  host: string;
  dnsPort: number;
  resolveAddress: string;
  zones: string[];
  logger: Logger;
}) {
  if (dnsPort === 0) {
    logger.info('DNS server disabled');
    return null;
  }

  const server = dns2.createUDPServer((request, send) => {
    const response = Packet.createResponseFromRequest(request);
    for (const question of request.questions) {
      const { name } = question;
      const type = (question as unknown as { type: number }).type;
      logger.debug({ name, type }, 'DNS query');
      if (type === Packet.TYPE.A && matchesZone(name, zones)) {
        response.answers.push({
          name,
          type: Packet.TYPE.A,
          class: Packet.CLASS.IN,
          ttl: 300,
          address: resolveAddress,
        });
      }
    }
    send(response);
  });

  server.on('requestError', (err: Error) => {
    logger.warn(err, 'DNS request parse error');
  });

  await server.listen(dnsPort, host);
  logger.info({ dnsPort, host }, 'DNS server listening');
  return server;
}
