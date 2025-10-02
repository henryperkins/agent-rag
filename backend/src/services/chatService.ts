import { decidePlan } from '../agents/planner.js';
import { agenticRetrieveTool, answerTool } from '../tools/index.js';
import { critiqueDraft } from '../agents/critic.js';
import { config } from '../config/app.js';
import type { AgentMessage, ChatResponse } from '../../../shared/types.js';

export async function handleChat(messages: AgentMessage[]): Promise<ChatResponse> {
  if (!messages?.length) {
    throw new Error('Messages array is required.');
  }

  const plan = await decidePlan(messages);
  let result = await agenticRetrieveTool({ messages });

  if (plan.action === 'answer') {
    const last = messages[messages.length - 1];
    const context = '';
    result = {
      response: (await answerTool({ question: last.content, context })).answer,
      references: [],
      activity: []
    };
  }

  const citations = result.references ?? [];
  const activity = result.activity ?? [];

  let finalAnswer = typeof result.response === 'string' ? result.response : 'No response generated.';

  if (config.ENABLE_CRITIC && plan.action === 'retrieve') {
    const question = messages[messages.length - 1].content;
    const context = citations.map((c) => c.content).join('\n\n');
    let iterations = 0;

    for (; iterations <= config.CRITIC_MAX_RETRIES; iterations++) {
      const critique = await critiqueDraft(finalAnswer, context, question);
      if (critique.action === 'accept') {
        break;
      }
      if (iterations < config.CRITIC_MAX_RETRIES && critique.suggestions?.length) {
        finalAnswer = `${finalAnswer}\n\n[Revision note: ${critique.suggestions.join('; ')}]`;
      }
    }
  }

  return {
    answer: finalAnswer,
    citations,
    activity,
    metadata: {
      retrieval_time_ms: undefined,
      critic_iterations: undefined
    }
  };
}
