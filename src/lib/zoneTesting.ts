import { setTimeZone } from './zone';

/**
 * Runs `fn` twice: in a process whose own zone is Europe/Amsterdam (the browser case) and in a UTC
 * process told to use Europe/Amsterdam (the Cloudflare Worker case). Both must give the same result.
 */
export function inBothModes<T>(fn: () => T): [T, T] {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Amsterdam';
    setTimeZone(undefined);
    const browser = fn();
    process.env.TZ = 'UTC';
    setTimeZone('Europe/Amsterdam');
    const worker = fn();
    return [browser, worker];
  } finally {
    process.env.TZ = saved;
    setTimeZone(undefined);
  }
}
