export const PlanSchema = {
  type: 'json_schema' as const,
  name: 'advanced_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { enum: ['vector_search', 'web_search', 'both', 'answer'] },
            query: { type: 'string' },
            k: { type: 'integer', minimum: 1, maximum: 20 }
          },
          required: ['action']
        },
        maxItems: 4
      }
    },
    required: ['confidence', 'steps']
  }
};

export const CriticSchema = {
  type: 'json_schema' as const,
  name: 'critic_report',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      grounded: { type: 'boolean' },
      coverage: { type: 'number', minimum: 0, maximum: 1 },
      issues: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 5
      },
      action: { enum: ['accept', 'revise'] }
    },
    required: ['grounded', 'coverage', 'action']
  }
};
