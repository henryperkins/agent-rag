import { config, isDevelopment } from './app.js';

function normalizeOrigin(origin: string) {
  const trimmed = origin.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : '';
    return `${protocol}//${hostname}${port}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

function expandOriginVariants(origin: string) {
  const trimmed = origin.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const url = new URL(trimmed);
    const variants = new Set<string>([url.origin]);

    if (url.hostname === 'localhost') {
      const portSegment = url.port ? `:${url.port}` : '';
      variants.add(`${url.protocol}//127.0.0.1${portSegment}`);
      variants.add(`${url.protocol}//[::1]${portSegment}`);
    }

    return Array.from(variants);
  } catch {
    return [trimmed];
  }
}

function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '[::1]'].includes(host) && /^https?:$/.test(url.protocol);
  } catch {
    return false;
  }
}

const configuredOrigins = config.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

const allowedOriginsSet = new Set(
  configuredOrigins
    .flatMap((origin) => expandOriginVariants(origin))
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)
);

export const allowedOrigins = Array.from(allowedOriginsSet);

export function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (allowedOriginsSet.has(normalizedOrigin)) {
    return true;
  }

  if (isDevelopment && isLoopbackOrigin(origin)) {
    return true;
  }

  return false;
}

export function resolveAllowedOrigin(origin?: string | null): string | undefined {
  if (!origin) {
    return undefined;
  }

  return isOriginAllowed(origin) ? origin : undefined;
}

export function getNormalizedOrigin(origin: string): string {
  return normalizeOrigin(origin);
}

export function isLoopback(origin?: string | null): boolean {
  if (!origin) {
    return false;
  }
  return isLoopbackOrigin(origin);
}
