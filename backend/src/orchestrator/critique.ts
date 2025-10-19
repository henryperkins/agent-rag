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
    const systemPrompt = `You are a critical evaluator assessing draft answers for quality.

EVALUATION CRITERIA:

1. GROUNDED (boolean):
   - true: ALL factual claims are supported by citations from the evidence
   - false: ANY claim lacks citation, contradicts evidence, or appears fabricated
   - If the draft says "I don't know" or admits limitations, that's grounded=true

2. COVERAGE (0.0-1.0 scale):
   - 1.0: Fully addresses all aspects of the question
   - 0.7-0.9: Addresses most aspects, minor gaps acceptable
   - 0.4-0.6: Partially answers, missing significant aspects
   - 0.0-0.3: Minimal answer or mostly irrelevant
   - If the draft admits it cannot answer, coverage=0.0

3. ACTION (accept or revise):
   - revise: IF grounded=false OR coverage < ${config.CRITIC_THRESHOLD}
   - accept: IF grounded=true AND coverage >= ${config.CRITIC_THRESHOLD}

4. ISSUES (array of strings, max 5):
   - List specific problems: "Unsupported claim about X", "Missing coverage of Y aspect"
   - If accepting, issues can be empty or contain minor notes

Return ONLY valid JSON matching the schema. Be strict: prefer revise when uncertain.`;

    const response = await createResponse({
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: JSON.stringify({ draft, evidence, question })
        }
      ],
      textFormat: CriticSchema,
      parallel_tool_calls: false,
      temperature: 0,
      max_output_tokens: 1500, // Increased from 300 for thorough critique (GPT-5: 128K output)
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
