import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { evaluateRetrieval, refineDocuments, applyCRAG, type CRAGEvaluation } from '../orchestrator/CRAG.js';
import type { Reference } from '../../../shared/types.js';
import * as openaiClient from '../azure/openaiClient.js';
import * as openaiUtils from '../utils/openai.js';

vi.mock('../azure/openaiClient.js', () => ({
  createResponse: vi.fn()
}));

vi.mock('../utils/openai.js', () => ({
  extractOutputText: vi.fn(),
  extractReasoningSummary: vi.fn()
}));

describe('CRAG Retrieval Evaluator', () => {
  let mockCreateResponse: MockInstance;
  let mockExtractOutputText: MockInstance;
  let mockExtractReasoningSummary: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateResponse = vi.mocked(openaiClient.createResponse);
    mockExtractOutputText = vi.mocked(openaiUtils.extractOutputText);
    mockExtractReasoningSummary = vi.mocked(openaiUtils.extractReasoningSummary);
    mockExtractReasoningSummary.mockReturnValue(undefined);
  });

  describe('evaluateRetrieval', () => {
    it('should return "incorrect" for empty documents', async () => {
      const query = 'What is the capital of France?';
      const documents: Reference[] = [];

      const result = await evaluateRetrieval(query, documents);

      expect(result.confidence).toBe('incorrect');
      expect(result.action).toBe('web_fallback');
      expect(result.reasoning).toContain('No documents retrieved');
    });

    it('should classify high-quality retrieval as "correct"', async () => {
      const query = 'What is the capital of France?';
      const documents: Reference[] = [
        { id: '1', title: 'France Geography', content: 'Paris is the capital and most populous city of France.' },
        { id: '2', title: 'European Capitals', content: 'Paris has been the capital of France since the 12th century.' }
      ];

      const mockEvaluation: CRAGEvaluation = {
        confidence: 'correct',
        action: 'use_documents',
        reasoning: 'Documents clearly contain relevant information about Paris being the capital of France.'
      };

      mockCreateResponse.mockResolvedValue({ id: 'resp-1' });
      mockExtractOutputText.mockReturnValue(JSON.stringify(mockEvaluation));

      const result = await evaluateRetrieval(query, documents);

      expect(result.confidence).toBe('correct');
      expect(result.action).toBe('use_documents');
      expect(mockCreateResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.0,
          max_output_tokens: 3000,
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('retrieval quality evaluator')
            }),
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('Query: What is the capital of France?')
            })
          ]),
          textFormat: expect.objectContaining({
            name: 'crag_evaluation',
            type: 'json_schema'
          })
        })
      );

      const requestPayload = mockCreateResponse.mock.calls[0][0];
      if (requestPayload.reasoning !== undefined) {
        expect(requestPayload.reasoning).toBeDefined();
      }
    });

    it('should classify mixed-quality retrieval as "ambiguous"', async () => {
      const query = 'What is the capital of France?';
      const documents: Reference[] = [
        { id: '1', title: 'France Geography', content: 'Paris is the capital of France.' },
        { id: '2', title: 'French Cuisine', content: 'French food is known for its rich flavors.' }
      ];

      const mockEvaluation: CRAGEvaluation = {
        confidence: 'ambiguous',
        action: 'refine_documents',
        reasoning: 'Some documents are relevant, but others are off-topic.',
        relevanceScores: [
          { documentIndex: 0, score: 0.9 },
          { documentIndex: 1, score: 0.2 }
        ]
      };

      mockCreateResponse.mockResolvedValue({ id: 'resp-2' });
      mockExtractOutputText.mockReturnValue(JSON.stringify(mockEvaluation));

      const result = await evaluateRetrieval(query, documents);

      expect(result.confidence).toBe('ambiguous');
      expect(result.action).toBe('refine_documents');
      expect(result.relevanceScores).toHaveLength(2);
    });

    it('should classify irrelevant retrieval as "incorrect"', async () => {
      const query = 'What is the capital of France?';
      const documents: Reference[] = [
        { id: '1', title: 'Italian Cities', content: 'Rome is the capital of Italy.' },
        { id: '2', title: 'Spanish Culture', content: 'Spain has a rich cultural heritage.' }
      ];

      const mockEvaluation: CRAGEvaluation = {
        confidence: 'incorrect',
        action: 'web_fallback',
        reasoning: 'Retrieved documents do not contain information about France or its capital.'
      };

      mockCreateResponse.mockResolvedValue({ id: 'resp-3' });
      mockExtractOutputText.mockReturnValue(JSON.stringify(mockEvaluation));

      const result = await evaluateRetrieval(query, documents);

      expect(result.confidence).toBe('incorrect');
      expect(result.action).toBe('web_fallback');
    });

    it('should handle evaluation errors gracefully', async () => {
      const query = 'What is the capital of France?';
      const documents: Reference[] = [
        { id: '1', title: 'France', content: 'Some content about France.' }
      ];

      mockCreateResponse.mockRejectedValue(new Error('OpenAI API error'));

      const result = await evaluateRetrieval(query, documents);

      expect(result.confidence).toBe('ambiguous');
      expect(result.action).toBe('use_documents');
      expect(result.reasoning).toContain('Evaluation failed');
    });
  });

  describe('refineDocuments', () => {
    it('should filter out documents below relevance threshold', () => {
      const documents: Reference[] = [
        { id: '1', title: 'Doc 1', content: 'Highly relevant content.' },
        { id: '2', title: 'Doc 2', content: 'Somewhat relevant content.' },
        { id: '3', title: 'Doc 3', content: 'Irrelevant content.' }
      ];

      const evaluation: CRAGEvaluation = {
        confidence: 'ambiguous',
        action: 'refine_documents',
        reasoning: 'Mixed relevance',
        relevanceScores: [
          { documentIndex: 0, score: 0.9 },
          { documentIndex: 1, score: 0.6 },
          { documentIndex: 2, score: 0.3 }
        ]
      };

      const refined = refineDocuments(documents, evaluation);

      expect(refined).toHaveLength(2);
      expect(refined[0].id).toBe('1');
      expect(refined[1].id).toBe('2');
      expect(refined[0].metadata?.crag_evaluated).toBe(true);
      expect(refined[0].metadata?.crag_relevance_score).toBe(0.9);
    });

    it('should extract only relevant sentences when provided', () => {
      const documents: Reference[] = [
        {
          id: '1',
          title: 'Long Document',
          content: 'This is a long document with multiple sentences. Only some are relevant. Others are not.'
        }
      ];

      const evaluation: CRAGEvaluation = {
        confidence: 'ambiguous',
        action: 'refine_documents',
        reasoning: 'Document contains relevant info but also noise',
        relevanceScores: [
          {
            documentIndex: 0,
            score: 0.7,
            relevantSentences: ['Only some are relevant.']
          }
        ]
      };

      const refined = refineDocuments(documents, evaluation);

      expect(refined).toHaveLength(1);
      expect(refined[0].content).toBe('Only some are relevant.');
      expect(refined[0].metadata?.crag_refined).toBe(true);
      expect(refined[0].metadata?.crag_original_length).toBeGreaterThan(0);
    });

    it('should return original documents if no relevance scores provided', () => {
      const documents: Reference[] = [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' }
      ];

      const evaluation: CRAGEvaluation = {
        confidence: 'ambiguous',
        action: 'refine_documents',
        reasoning: 'No detailed scores available'
      };

      const refined = refineDocuments(documents, evaluation);

      expect(refined).toEqual(documents);
    });

    it('should return original documents if all are filtered out', () => {
      const documents: Reference[] = [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' }
      ];

      const evaluation: CRAGEvaluation = {
        confidence: 'ambiguous',
        action: 'refine_documents',
        reasoning: 'All documents below threshold',
        relevanceScores: [
          { documentIndex: 0, score: 0.2 },
          { documentIndex: 1, score: 0.3 }
        ]
      };

      const refined = refineDocuments(documents, evaluation);

      expect(refined).toEqual(documents);
    });
  });

  describe('applyCRAG', () => {
    it('should use documents without modification for "correct" confidence', async () => {
      const query = 'What is machine learning?';
      const documents: Reference[] = [
        { id: '1', title: 'ML Intro', content: 'Machine learning is a subset of AI.' }
      ];

      const mockEvaluation: CRAGEvaluation = {
        confidence: 'correct',
        action: 'use_documents',
        reasoning: 'Documents are highly relevant.'
      };

      mockCreateResponse.mockResolvedValue({ id: 'resp-1' });
      mockExtractOutputText.mockReturnValue(JSON.stringify(mockEvaluation));

      const result = await applyCRAG(query, documents);

      expect(result.evaluation.confidence).toBe('correct');
      expect(result.refinedDocuments).toBeUndefined();
      expect(result.shouldTriggerWebSearch).toBe(false);
      expect(result.activity).toHaveLength(3);
      expect(result.activity[0].type).toBe('crag_evaluation');
      expect(result.activity[1].type).toBe('crag_result');
      expect(result.activity[2].type).toBe('crag_action');
    });

    it('should refine documents for "ambiguous" confidence', async () => {
      const query = 'What is deep learning?';
      const documents: Reference[] = [
        { id: '1', title: 'Deep Learning', content: 'Deep learning uses neural networks.' },
        { id: '2', title: 'Random Topic', content: 'Unrelated content here.' }
      ];

      const mockEvaluation: CRAGEvaluation = {
        confidence: 'ambiguous',
        action: 'refine_documents',
        reasoning: 'Some relevant, some irrelevant.',
        relevanceScores: [
          { documentIndex: 0, score: 0.8 },
          { documentIndex: 1, score: 0.3 }
        ]
      };

      mockCreateResponse.mockResolvedValue({ id: 'resp-2' });
      mockExtractOutputText.mockReturnValue(JSON.stringify(mockEvaluation));

      const result = await applyCRAG(query, documents);

      expect(result.evaluation.confidence).toBe('ambiguous');
      expect(result.refinedDocuments).toBeDefined();
      expect(result.refinedDocuments).toHaveLength(1);
      expect(result.shouldTriggerWebSearch).toBe(false);
      expect(result.activity.some((a) => a.type === 'crag_refinement')).toBe(true);
    });

    it('should trigger web search for "incorrect" confidence', async () => {
      const query = 'What is quantum computing?';
      const documents: Reference[] = [
        { id: '1', title: 'Cooking Tips', content: 'How to bake a cake.' }
      ];

      const mockEvaluation: CRAGEvaluation = {
        confidence: 'incorrect',
        action: 'web_fallback',
        reasoning: 'Documents are completely irrelevant.'
      };

      mockCreateResponse.mockResolvedValue({ id: 'resp-3' });
      mockExtractOutputText.mockReturnValue(JSON.stringify(mockEvaluation));

      const result = await applyCRAG(query, documents);

      expect(result.evaluation.confidence).toBe('incorrect');
      expect(result.shouldTriggerWebSearch).toBe(true);
      expect(result.activity.some((a) => a.type === 'crag_web_fallback')).toBe(true);
    });

    it('should handle evaluation errors in applyCRAG', async () => {
      const query = 'Test query';
      const documents: Reference[] = [
        { id: '1', title: 'Test', content: 'Test content' }
      ];

      mockCreateResponse.mockRejectedValue(new Error('API error'));

      const result = await applyCRAG(query, documents);

      expect(result.evaluation.confidence).toBe('ambiguous');
      expect(result.evaluation.action).toBe('use_documents');
      expect(result.shouldTriggerWebSearch).toBe(false);
    });
  });
});
