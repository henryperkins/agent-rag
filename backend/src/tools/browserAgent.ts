import type { ActivityStep, Reference, AgentMessage } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { withRetry } from '../utils/resilience.js';
import { randomUUID } from 'node:crypto';

/**
 * Browser agent types and their capabilities
 */
export type BrowserAgentType = 'browser_use' | 'openai_cua' | 'claude_cua';

export interface BrowserAgentOptions {
  agentType?: BrowserAgentType;
  maxSteps?: number;
  sessionOptions?: Record<string, unknown>;
  returnStepInfo?: boolean;
  profileId?: string; // For session reuse
}

export interface BrowserAgentResult {
  answer: string;
  references: Reference[];
  activity: ActivityStep[];
  sessionProfile?: string;
  steps?: Array<{
    action: string;
    reasoning?: string;
    screenshot?: string;
  }>;
  metadata?: {
    totalSteps: number;
    agentType: BrowserAgentType;
    sessionId?: string;
    liveUrl?: string;
  };
}

interface BrowserAgentArgs {
  query: string;
  context?: string;
  messages?: AgentMessage[];
  options?: BrowserAgentOptions;
}

/**
 * Determines which browser agent to use based on task complexity
 */
function selectBrowserAgent(query: string, options?: BrowserAgentOptions): BrowserAgentType {
  if (options?.agentType) {
    return options.agentType;
  }

  // Simple heuristics for agent selection
  const queryLower = query.toLowerCase();
  const complexityIndicators = [
    'compare',
    'analyze',
    'research',
    'investigate',
    'deep dive',
    'comprehensive',
    'detailed analysis',
    'multi-step',
    'navigate',
    'extract from multiple',
  ];

  const isComplex = complexityIndicators.some((indicator) => queryLower.includes(indicator));

  // Claude CUA for complex reasoning tasks
  if (isComplex) {
    return 'claude_cua';
  }

  // OpenAI CUA for balanced performance
  if (queryLower.includes('recent') || queryLower.includes('latest') || queryLower.includes('current')) {
    return 'openai_cua';
  }

  // Browser Use agent for speed and cost efficiency (default)
  return 'browser_use';
}

/**
 * Builds a detailed task instruction for the browser agent
 */
function buildAgentTask(query: string, context?: string, messages?: AgentMessage[]): string {
  const conversationContext = messages
    ?.slice(-3)
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join('\n');

  const taskParts: string[] = [];

  if (conversationContext) {
    taskParts.push(`# Conversation Context\n${conversationContext}\n`);
  }

  if (context) {
    taskParts.push(`# Background Information\n${context}\n`);
  }

  taskParts.push(`# Research Task\n${query}\n`);

  taskParts.push(`# Instructions
1. Search the web for the most current and authoritative information
2. Navigate to top 3-5 relevant sources
3. Extract key facts, data points, and insights
4. Synthesize findings into a comprehensive answer
5. Include source URLs and publication dates
6. Format the response as:
   - **Summary**: Brief overview (2-3 sentences)
   - **Key Findings**: Bulleted list of main points
   - **Detailed Analysis**: In-depth explanation
   - **Sources**: List of URLs with titles and dates

Focus on accuracy, recency, and credibility. Prioritize peer-reviewed sources, official documentation, and authoritative publications.`);

  return taskParts.join('\n\n');
}

/**
 * Parse browser agent response into structured format
 */
function parseAgentResponse(rawResponse: string): {
  answer: string;
  sources: Array<{ url: string; title?: string; date?: string }>;
} {
  const sources: Array<{ url: string; title?: string; date?: string }> = [];

  // Extract URLs from response
  const urlRegex = /https?:\/\/[^\s)]+/g;
  const urls = rawResponse.match(urlRegex) || [];

  // Try to extract structured sources section
  const sourcesMatch = rawResponse.match(/(?:##?\s*Sources?|References?)[:\s]*([\s\S]*?)(?:\n##|$)/i);
  if (sourcesMatch) {
    const sourcesSection = sourcesMatch[1];
    const lines = sourcesSection.split('\n').filter((line) => line.trim());

    lines.forEach((line) => {
      const urlMatch = line.match(/https?:\/\/[^\s)]+/);
      if (urlMatch) {
        const url = urlMatch[0];
        const titleMatch = line.match(/["[]([^"\]]+)["\]]/);
        const dateMatch = line.match(/\((\d{4}[-/]\d{1,2}[-/]\d{1,2})\)/);

        sources.push({
          url,
          title: titleMatch?.[1],
          date: dateMatch?.[1],
        });
      }
    });
  } else {
    // Fallback: just collect unique URLs
    const uniqueUrls = [...new Set(urls)];
    uniqueUrls.forEach((url) => {
      sources.push({ url });
    });
  }

  return {
    answer: rawResponse,
    sources,
  };
}

/**
 * Convert browser agent response to RAG References
 */
function convertToReferences(
  sources: Array<{ url: string; title?: string; date?: string }>
): Reference[] {
  return sources.map((source, index) => ({
    id: `browser_agent_${randomUUID()}`,
    title: source.title || `Source ${index + 1}`,
    content: '', // Browser agent provides synthesized content, not raw source content
    url: source.url,
    score: 1.0 - index * 0.1, // Decreasing relevance score
    metadata: {
      source: 'browser_agent',
      fetchedAt: new Date().toISOString(),
      publishDate: source.date,
      extractedVia: 'autonomous_browser_agent',
    },
  }));
}

/**
 * Main browser agent tool for complex research tasks
 */
export async function browserAgentTool(args: BrowserAgentArgs): Promise<BrowserAgentResult> {
  const { query, context, messages, options } = args;

  // Import MCP tools dynamically
  let mcp__hyperbrowser__browser_use_agent: any;
  let mcp__hyperbrowser__openai_computer_use_agent: any;
  let mcp__hyperbrowser__claude_computer_use_agent: any;
  let mergeSessionOptions: any;

  try {
    // @ts-expect-error MCP tools are optional and may not be available
    const mcpTools = await import('../../../mcp-tools.js');
    mcp__hyperbrowser__browser_use_agent = mcpTools.mcp__hyperbrowser__browser_use_agent;
    mcp__hyperbrowser__openai_computer_use_agent = mcpTools.mcp__hyperbrowser__openai_computer_use_agent;
    mcp__hyperbrowser__claude_computer_use_agent = mcpTools.mcp__hyperbrowser__claude_computer_use_agent;
    mergeSessionOptions = mcpTools.mergeSessionOptions;
  } catch (error) {
    throw new Error(
      `Browser agent MCP tools not available. Ensure hyperbrowser-mcp is configured. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const agentType = selectBrowserAgent(query, options);
  const task = buildAgentTask(query, context, messages);
  const maxSteps = options?.maxSteps ?? config.BROWSER_AGENT_MAX_STEPS ?? 25;

  const sessionOptions = mergeSessionOptions({
    useStealth: true,
    useProxy: false,
    ...(options?.sessionOptions ?? {}),
    ...(options?.profileId ? { profile: { id: options.profileId, persistChanges: true } } : {}),
  });

  const activity: ActivityStep[] = [];

  activity.push({
    type: 'browser_agent_start',
    description: `Starting ${agentType} agent with max ${maxSteps} steps`,
    timestamp: new Date().toISOString(),
  });

  // Select and invoke the appropriate agent
  let agentFn: any;
  switch (agentType) {
    case 'claude_cua':
      agentFn = mcp__hyperbrowser__claude_computer_use_agent;
      break;
    case 'openai_cua':
      agentFn = mcp__hyperbrowser__openai_computer_use_agent;
      break;
    case 'browser_use':
    default:
      agentFn = mcp__hyperbrowser__browser_use_agent;
      break;
  }

  const result = await withRetry(
    'browser-agent',
    async (_signal) => {
      return await agentFn({
        task,
        maxSteps,
        sessionOptions,
        returnStepInfo: options?.returnStepInfo ?? false,
      });
    },
    {
      maxRetries: 1, // Browser agents are expensive; limit retries
      timeoutMs: maxSteps * 30000, // 30s per step
      retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'AbortError'],
    }
  );

  if (result.status === 'failed' || result.error) {
    activity.push({
      type: 'browser_agent_error',
      description: `Agent failed: ${result.error || 'Unknown error'}`,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Browser agent failed: ${result.error || 'Unknown error'}`);
  }

  activity.push({
    type: 'browser_agent_complete',
    description: `Agent completed in ${result.data?.steps?.length ?? 0} steps`,
    timestamp: new Date().toISOString(),
  });

  // Parse the agent's response
  const rawAnswer =
    typeof result.data?.result === 'string'
      ? result.data.result
      : typeof result.data?.answer === 'string'
        ? result.data.answer
        : JSON.stringify(result.data ?? {});

  const { answer, sources } = parseAgentResponse(rawAnswer);

  // Convert sources to references
  const references = convertToReferences(sources);

  // Add activity steps from agent if available
  if (result.data?.steps && Array.isArray(result.data.steps)) {
    result.data.steps.slice(0, 5).forEach((step: any, index: number) => {
      activity.push({
        type: 'browser_agent_step',
        description: step.action || step.reasoning || `Step ${index + 1}`,
        timestamp: new Date().toISOString(),
      });
    });
  }

  return {
    answer,
    references,
    activity,
    sessionProfile: options?.profileId,
    steps: options?.returnStepInfo ? result.data?.steps : undefined,
    metadata: {
      totalSteps: result.data?.steps?.length ?? 0,
      agentType,
      sessionId: result.jobId,
      liveUrl: result.liveUrl,
    },
  };
}

/**
 * Determine if a query should use browser agent instead of regular web search
 */
export function shouldUseBrowserAgent(query: string, planConfidence: number, stepCount: number): boolean {
  if (!config.ENABLE_BROWSER_AGENT) {
    return false;
  }

  const queryLower = query.toLowerCase();

  // Trigger conditions
  const isComplexResearch =
    stepCount >= 3 || // Plan has multiple steps
    query.length > 100 || // Long, detailed query
    queryLower.includes('research') ||
    queryLower.includes('investigate') ||
    queryLower.includes('analyze') ||
    queryLower.includes('compare') ||
    queryLower.includes('comprehensive');

  const requiresInteraction =
    queryLower.includes('navigate') ||
    queryLower.includes('download') ||
    queryLower.includes('extract from multiple') ||
    queryLower.includes('step-by-step');

  const requiresRecency =
    queryLower.includes('latest') ||
    queryLower.includes('recent') ||
    queryLower.includes('current') ||
    queryLower.includes('breaking') ||
    queryLower.includes('today') ||
    queryLower.includes('this week');

  // Use browser agent if:
  // 1. Complex research task with low planner confidence, OR
  // 2. Requires interaction/navigation, OR
  // 3. Requires recency AND multiple steps
  return (
    (isComplexResearch && planConfidence < 0.7) || requiresInteraction || (requiresRecency && stepCount >= 2)
  );
}

/**
 * Estimate cost of browser agent operation
 * Returns estimated cost in USD
 */
export function estimateBrowserAgentCost(agentType: BrowserAgentType, maxSteps: number): number {
  // Hyperbrowser pricing (approximate)
  const baseCost = 0.01; // $0.01 per session start
  const stepCost = {
    browser_use: 0.005, // $0.005 per step (fastest, cheapest)
    openai_cua: 0.015, // $0.015 per step (balanced)
    claude_cua: 0.025, // $0.025 per step (most capable, expensive)
  };

  return baseCost + maxSteps * (stepCost[agentType] ?? stepCost.browser_use);
}
