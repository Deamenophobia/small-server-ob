import { createConfig } from '../config.mjs';
import { httpCheck } from './http.mjs';
import { tcpCheck } from './tcp.mjs';
import { sshCheck } from './ssh.mjs';

export const builtinAdapters = Object.freeze({ http: httpCheck, tcp: tcpCheck, ssh: sshCheck });

/** Adapters take a validated check and config, and return an observation without its timestamp. */
export function createChecker({ config = createConfig(), adapters = builtinAdapters } = {}) {
  return async function runCheck(server) {
    let result;
    try {
      result = await adapters[server.check.type](server.check, config);
    } catch (error) {
      const known = {
        ECONNREFUSED: 'Connection refused.',
        ENOTFOUND: 'Hostname not found.',
        EHOSTUNREACH: 'Host unreachable.',
        ENETUNREACH: 'Network unreachable.',
        ETIMEDOUT: 'Connection timed out.',
        CERT_HAS_EXPIRED: 'TLS certificate expired.',
        DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is not trusted.',
      };
      result = {
        status: server.check.type === 'ssh' ? 'unknown' : 'down',
        latencyMs: null,
        message:
          known[error.code] ??
          (error.code
            ? 'Connection failed. Check the address and TLS configuration.'
            : error.message.slice(0, 250)),
      };
    }
    return { ...result, at: new Date().toISOString() };
  };
}

export const runCheck = createChecker();
