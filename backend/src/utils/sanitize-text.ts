const SCRIPT_TAG_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const HTML_TAG_REGEX = /<[^>]*>/g;
const CODE_BLOCK_REGEX = /<\/?(code|pre)>/gi;

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_GROUPED_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
const CREDIT_CARD_PLAIN_REGEX = /\b\d{13,16}\b/g;
const URL_REGEX = /\b(?:https?:\/\/|mailto:|www\.)[^\s<>"')]+/gi;
const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const HEX_ID_REGEX = /\b[0-9a-f]{32,64}\b/gi;
const TOKEN_REGEX = /\b[A-Za-z0-9_-]{32,}\b/g;

interface RedactionPattern {
  pattern: RegExp;
  replacement: string;
}

const REDACTION_PATTERNS: RedactionPattern[] = [
  { pattern: EMAIL_REGEX, replacement: '[EMAIL]' },
  { pattern: SSN_REGEX, replacement: '[SSN]' },
  { pattern: CREDIT_CARD_GROUPED_REGEX, replacement: '[CARD]' },
  { pattern: CREDIT_CARD_PLAIN_REGEX, replacement: '[CARD]' },
  { pattern: URL_REGEX, replacement: '[URL]' },
  { pattern: UUID_REGEX, replacement: '[ID]' },
  { pattern: HEX_ID_REGEX, replacement: '[ID]' },
  { pattern: TOKEN_REGEX, replacement: '[TOKEN]' }
];

function stripHtml(content: string): string {
  let sanitized = content.replace(SCRIPT_TAG_REGEX, '');
  sanitized = sanitized.replace(CODE_BLOCK_REGEX, '`');
  sanitized = sanitized.replace(HTML_TAG_REGEX, '');
  return sanitized;
}

function normalizeWhitespace(content: string): string {
  let normalized = content.replace(/\r\n?/g, '\n');
  normalized = normalized.replace(/\u00a0/g, ' ');
  const lines = normalized.split('\n').map((line) => line.replace(/\s+$/g, ''));
  normalized = lines.join('\n');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  return normalized.trim();
}

export function sanitizeUserContent(content: string): string {
  if (!content) {
    return '';
  }
  const stripped = stripHtml(content);
  return normalizeWhitespace(stripped);
}

export function redactSensitiveText(content: string): string {
  if (!content) {
    return '';
  }
  return REDACTION_PATTERNS.reduce(
    (accumulator, { pattern, replacement }) => accumulator.replace(pattern, replacement),
    content
  );
}

export function sanitizeAndRedactText(content: string): string {
  return redactSensitiveText(sanitizeUserContent(content));
}

export function sanitizeAndRedactOptional(content?: string | null): string | undefined {
  if (content === undefined || content === null) {
    return undefined;
  }
  const result = sanitizeAndRedactText(content);
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sanitizeAndRedactDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeAndRedactText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAndRedactDeep(item)) as unknown as T;
  }

  if (value instanceof Date || value instanceof RegExp) {
    return value;
  }

  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = sanitizeAndRedactDeep(nested);
    }
    return next as T;
  }

  return value;
}
