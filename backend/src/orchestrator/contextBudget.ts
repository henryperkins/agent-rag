import { encoding_for_model, get_encoding } from '@dqbd/tiktoken';
import type { TiktokenEncoding, TiktokenModel } from '@dqbd/tiktoken';

type Encoding = ReturnType<typeof encoding_for_model>;

const cache = new Map<string, Encoding>();
const FALLBACK_ENCODING: TiktokenEncoding = 'o200k_base';

function getEncoding(model: string): Encoding {
  if (cache.has(model)) {
    return cache.get(model)!;
  }

  try {
    const encoding = encoding_for_model(model as TiktokenModel);
    cache.set(model, encoding);
    return encoding;
  } catch (_error) {
    console.warn(`Unknown model '${model}', falling back to ${FALLBACK_ENCODING} encoding.`);

    if (!cache.has(FALLBACK_ENCODING)) {
      cache.set(FALLBACK_ENCODING, get_encoding(FALLBACK_ENCODING));
    }

    const fallbackEncoding = cache.get(FALLBACK_ENCODING)!;
    cache.set(model, fallbackEncoding);
    return fallbackEncoding;
  }
}

export interface BudgetOptions {
  model: string;
  sections: Record<string, string>;
  caps: Record<string, number>;
}

export function budgetSections({ model, sections, caps }: BudgetOptions) {
  const encoding = getEncoding(model);
  const packed: Record<string, string> = {};

  for (const [key, value] of Object.entries(sections)) {
    const cap = caps[key] ?? 0;
    if (cap <= 0) {
      packed[key] = value ?? '';
      continue;
    }

    const lines = (value ?? '').split('\n');
    while (lines.length > 0) {
      const candidate = lines.join('\n');
      const tokens = encoding.encode(candidate).length;
      if (tokens <= cap) {
        packed[key] = candidate;
        break;
      }
      lines.shift(); // drop oldest entry
    }

    if (!(key in packed)) {
      packed[key] = lines.slice(-1).join('\n');
    }
  }

  return packed;
}

export function estimateTokens(model: string, text: string) {
  const encoding = getEncoding(model);
  return encoding.encode(text ?? '').length;
}
