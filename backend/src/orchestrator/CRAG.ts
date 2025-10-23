import { z } from 'zod';
import { createResponse } from '../azure/openaiClient.js';
import { extractOutputText, extractReasoningSummary } from '../utils/openai.js';
import { CRAGEvaluationSchema } from './schemas.js';
import { config } from '../config/app.js';
import type { Reference, ActivityStep } from '../../../shared/types.js';
import { getReasoningOptions } from '../config/reasoning.js';

// ============================================================================
// Types
// ============================================================================

export interface CRAGEvaluation {
  confidence: 'correct' | 'ambiguous' | 'incorrect';
  action: 'use_documents' | 'refine_documents' | 'web_fallback';
  reasoning: string;
  relevanceScores?: Array<{
    documentIndex: number;
    score: number;
    relevantSentences?: string[];
  }>;
  reasoningSummary?: string;
}

export interface CRAGResult {
  evaluation: CRAGEvaluation;
  refinedDocuments?: Reference[];
  activity: ActivityStep[];
  shouldTriggerWebSearch: boolean;
  reasoningSummary?: string;
}

const CRAGEvaluationValidator = z.object({
  confidence: z.enum(['correct', 'ambiguous', 'incorrect']),
  action: z.enum(['use_documents', 'refine_documents', 'web_fallback']),
  reasoning: z.string(),
  relevanceScores: z
    .array(
      z.object({
        documentIndex: z.number().int().min(0),
        score: z.number().min(0).max(1),
        relevantSentences: z.array(z.string()).optional()
      })
    )
    .optional()
});

// ============================================================================
// Core Evaluator
// ============================================================================

/**
 * Evaluates retrieved documents for relevance to query using Azure OpenAI.
 * Implements CRAG (Corrective Retrieval Augmented Generation) self-grading.
 *
 * @param query - The user's query
 * @param documents - Retrieved documents to evaluate
 * @returns CRAG evaluation with confidence level and recommended action
 */
export async function evaluateRetrieval(
  query: string,
  documents: Reference[]
): Promise<CRAGEvaluation> {
  if (documents.length === 0) {
    return {
      confidence: 'incorrect',
      action: 'web_fallback',
      reasoning: 'No documents retrieved from vector search.'
    };
  }

  // Prepare document context for evaluation
  const documentContext = documents
    .map((doc, idx) => {
      const content = doc.content || doc.chunk || '';
      const title = doc.title || `Document ${idx + 1}`;
      return `[${idx}] ${title}\n${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`;
    })
    .join('\n\n');

  const evaluationPrompt = `Query: ${query}

Retrieved Documents:
${documentContext}

Instructions:
Evaluate if the retrieved documents contain relevant information to answer the query.

Classify the retrieval quality as:
- "correct": Documents clearly contain relevant information to answer the query
- "ambiguous": Documents contain some relevant information but may be incomplete or mixed with irrelevant content
- "incorrect": Documents do not contain relevant information to answer the query

Based on your classification, recommend an action:
- "use_documents": Use the documents as-is (for correct retrieval)
- "refine_documents": Filter and extract only relevant portions (for ambiguous retrieval)
- "web_fallback": Trigger web search to supplement or replace documents (for incorrect retrieval)

For each document, assign a relevance score (0-1) and optionally identify relevant sentences for refinement.`;

  try {
    const reasoningConfig = getReasoningOptions('crag');
    const response = await createResponse({
      messages: [
        {
          role: 'system',
          content:
            'You are a retrieval quality evaluator for a RAG system. Assess document relevance objectively and recommend corrective actions.'
        },
        {
          role: 'user',
          content: evaluationPrompt
        }
      ],
      textFormat: CRAGEvaluationSchema,
      temperature: 0.0,
      max_output_tokens: 4500, // Increased from 3000 to prevent evaluator truncation (GPT-5: 128K output)
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      reasoning: reasoningConfig
    });

    const evaluationText = extractOutputText(response);
    const normalizedEvaluationText = typeof evaluationText === 'string' ? evaluationText.trim() : '';
    if (!normalizedEvaluationText) {
      const status = response?.status ?? 'unknown';
      const reason = response?.incomplete_details?.reason;
      const errorMessage = response?.error?.message;
      const detailSegments = [
        status ? `status=${status}${reason ? `:${reason}` : ''}` : null,
        errorMessage ? `error=${errorMessage}` : null
      ].filter(Boolean);
      const detailSuffix = detailSegments.length > 0 ? ` (${detailSegments.join(', ')})` : '';
      throw new Error(`Empty evaluation payload${detailSuffix}`);
    }

    let evaluation: CRAGEvaluation;
    try {
      const rawEvaluation = JSON.parse(normalizedEvaluationText);
      const parsedEvaluation = CRAGEvaluationValidator.safeParse(rawEvaluation);
      if (!parsedEvaluation.success) {
        throw parsedEvaluation.error;
      }
      evaluation = parsedEvaluation.data as CRAGEvaluation;
    } catch (parseError: any) {
      const message =
        parseError instanceof Error
          ? parseError.message
          : typeof parseError === 'string'
          ? parseError
          : JSON.stringify(parseError);
      throw new Error(`Invalid evaluation JSON: ${message}`);
    }

    // Only extract reasoning summaries if reasoning config is enabled
    if (reasoningConfig) {
      const reasoningSummary = extractReasoningSummary(response);
      if (reasoningSummary) {
        evaluation.reasoningSummary = reasoningSummary.join(' ');
      }
    }

    return evaluation;
  } catch (error: any) {
    console.error('CRAG evaluation error:', error.message);
    // Fallback: assume documents are usable if evaluation fails
    return {
      confidence: 'ambiguous',
      action: 'use_documents',
      reasoning: `Evaluation failed (${error.message}). Defaulting to using documents.`
    };
  }
}

// ============================================================================
// Knowledge Refinement
// ============================================================================

/**
 * Refines documents by filtering out irrelevant content based on CRAG evaluation.
 * Implements strip-level filtering for ambiguous retrievals.
 *
 * @param documents - Original retrieved documents
 * @param evaluation - CRAG evaluation with relevance scores
 * @returns Refined documents with irrelevant content removed
 */
export function refineDocuments(documents: Reference[], evaluation: CRAGEvaluation): Reference[] {
  if (!evaluation.relevanceScores || evaluation.relevanceScores.length === 0) {
    // No detailed scores available, keep all documents above a generic threshold
    return documents;
  }

  const refined: Reference[] = [];

  for (const scoreInfo of evaluation.relevanceScores) {
    const { documentIndex, score, relevantSentences } = scoreInfo;

    // Only keep documents with relevance score >= 0.5
    if (score < 0.5) {
      continue;
    }

    const originalDoc = documents[documentIndex];
    if (!originalDoc) {
      continue;
    }

    // If relevant sentences are provided, use only those
    if (relevantSentences && relevantSentences.length > 0) {
      refined.push({
        ...originalDoc,
        content: relevantSentences.join(' '),
        chunk: relevantSentences.join(' '),
        metadata: {
          ...originalDoc.metadata,
          crag_refined: true,
          crag_original_length: (originalDoc.content || originalDoc.chunk || '').length,
          crag_relevance_score: score
        }
      });
    } else {
      // Keep full document but mark it as evaluated
      refined.push({
        ...originalDoc,
        metadata: {
          ...originalDoc.metadata,
          crag_evaluated: true,
          crag_relevance_score: score
        }
      });
    }
  }

  return refined.length > 0 ? refined : documents;
}

// ============================================================================
// Main CRAG Workflow
// ============================================================================

/**
 * Executes the full CRAG workflow: evaluate retrieval quality and take corrective action.
 *
 * @param query - The user's query
 * @param documents - Retrieved documents to evaluate
 * @returns CRAG result with evaluation, refined documents, and activity log
 */
export async function applyCRAG(query: string, documents: Reference[]): Promise<CRAGResult> {
  const activity: ActivityStep[] = [];

  // Step 1: Evaluate retrieval quality
  activity.push({
    type: 'crag_evaluation',
    description: 'Evaluating retrieval quality with CRAG self-grading...'
  });

  const evaluation = await evaluateRetrieval(query, documents);

  activity.push({
    type: 'crag_result',
    description: `CRAG: ${evaluation.confidence} confidence → ${evaluation.action}. ${evaluation.reasoning}`
  });

  // Step 2: Take corrective action based on evaluation
  let refinedDocuments: Reference[] | undefined;
  let shouldTriggerWebSearch = false;

  switch (evaluation.action) {
    case 'use_documents':
      // Documents are good, use as-is
      activity.push({
        type: 'crag_action',
        description: `Using ${documents.length} documents without modification.`
      });
      break;

    case 'refine_documents':
      // Filter and refine documents
      refinedDocuments = refineDocuments(documents, evaluation);
      activity.push({
        type: 'crag_refinement',
        description: `Refined ${documents.length} documents to ${refinedDocuments.length} high-relevance documents.`
      });
      break;

    case 'web_fallback':
      // Trigger web search fallback
      shouldTriggerWebSearch = true;
      activity.push({
        type: 'crag_web_fallback',
        description: 'Vector search insufficient. Triggering web search fallback.'
      });
      break;
  }

  return {
    evaluation,
    refinedDocuments,
    activity,
    shouldTriggerWebSearch,
    reasoningSummary: evaluation.reasoningSummary
  };
}
