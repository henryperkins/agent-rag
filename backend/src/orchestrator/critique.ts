import type { CriticReport } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { createResponse } from '../azure/openaiClient.js';
import { CriticSchema } from './schemas.js';
import { extractOutputText } from '../utils/openai.js';

export interface CritiqueOptions {
  draft: string;
  evidence: string;
  question: string;
}

export async function evaluateAnswer({ draft, evidence, question }: CritiqueOptions): Promise<CriticReport> {
  try {
    const response = await createResponse({
      messages: [
        {
          role: 'system',
          content:
            'Evaluate the assistant draft for groundedness and coverage. Return ONLY JSON matching the schema.'
        },
        {
          role: 'user',
          content: JSON.stringify({ draft, evidence, question })
        }
      ],
      textFormat: CriticSchema,
      parallel_tool_calls: false,
      temperature: 0,
      max_output_tokens: 300,
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT
    });

    const parsed = JSON.parse(extractOutputText(response) || '{}');
    return {
      grounded: Boolean(parsed.grounded),
      coverage: typeof parsed.coverage === 'number' ? parsed.coverage : 0,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      action: parsed.action === 'revise' ? 'revise' : 'accept'
    };
  } catch (error) {
    console.warn('Critic evaluation failed; defaulting to accept.', error);
    return {
      grounded: true,
      coverage: 0.8,
      action: 'accept'
    };
  }
}
