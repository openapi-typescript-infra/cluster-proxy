import isEqual from 'lodash.isequal';
import type { Logger } from 'pino';

export function getTerseLogger(baseLogger: Logger): Logger {
  let lastInfo: [object | undefined, string | undefined] = [undefined, undefined];
  let lastDebug: [object | undefined, string | undefined] = [undefined, undefined];

  return {
    ...baseLogger,
    debug(obj: object, msg?: string) {
      if (msg !== lastDebug[1] || !isEqual(obj, lastDebug[0])) {
        baseLogger.debug(obj, msg);
        lastDebug = [obj, msg];
      }
    },
    info(obj: object, msg?: string) {
      if (msg !== lastInfo[1] || !isEqual(obj, lastInfo[0])) {
        baseLogger.info(obj, msg);
        lastInfo = [obj, msg];
      }
    },
    trace: baseLogger.trace.bind(baseLogger),
    warn: baseLogger.warn.bind(baseLogger),
    error: baseLogger.error.bind(baseLogger),
    fatal: baseLogger.fatal.bind(baseLogger),
  };
}
