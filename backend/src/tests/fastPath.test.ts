import { describe, it, expect } from 'vitest';
import { shouldUseFastPath, analyzeFastPath, FAST_PATH_TEST_CASES } from '../orchestrator/fastPath.js';

describe('Fast Path Detection', () => {
  describe('shouldUseFastPath', () => {
    it('should return false for invalid inputs', () => {
      expect(shouldUseFastPath('')).toBe(false);
      expect(shouldUseFastPath(null as any)).toBe(false);
      expect(shouldUseFastPath(undefined as any)).toBe(false);
      expect(shouldUseFastPath(123 as any)).toBe(false);
    });

    it('should return false for very short queries', () => {
      expect(shouldUseFastPath('hi')).toBe(false);
      expect(shouldUseFastPath('x')).toBe(false);
      expect(shouldUseFastPath('test')).toBe(false); // 4 chars
    });

    it('should return false for very long queries', () => {
      const longQuery = 'a'.repeat(201);
      expect(shouldUseFastPath(longQuery)).toBe(false);
    });

    it('should detect simple definitional queries', () => {
      expect(shouldUseFastPath('What is an aurora?')).toBe(true);
      expect(shouldUseFastPath('what are satellites?')).toBe(true);
      expect(shouldUseFastPath('who is the author')).toBe(true);
      expect(shouldUseFastPath('where is the location')).toBe(true);
      expect(shouldUseFastPath('when was it discovered')).toBe(true);
    });

    it('should detect show/display commands', () => {
      expect(shouldUseFastPath('show me earth images')).toBe(true);
      expect(shouldUseFastPath('display the results')).toBe(true);
      expect(shouldUseFastPath('find aurora data')).toBe(true);
      expect(shouldUseFastPath('show aurora')).toBe(true);
    });

    it('should detect list commands', () => {
      expect(shouldUseFastPath('list all satellites')).toBe(true);
      expect(shouldUseFastPath('list the images')).toBe(true);
      expect(shouldUseFastPath('list planets')).toBe(true);
    });

    it('should detect definition requests', () => {
      expect(shouldUseFastPath('definition of aurora')).toBe(true);
      expect(shouldUseFastPath('meaning of geosynchronous')).toBe(true);
      expect(shouldUseFastPath('explanation of orbit')).toBe(true);
    });

    it('should detect simple how-to queries', () => {
      expect(shouldUseFastPath('how to observe auroras')).toBe(true);
      expect(shouldUseFastPath('how to find satellites')).toBe(true);
    });

    it('should detect entity lookups', () => {
      expect(shouldUseFastPath('aurora overview')).toBe(true);
      expect(shouldUseFastPath('satellite summary')).toBe(true);
      expect(shouldUseFastPath('earth definition')).toBe(true);
      expect(shouldUseFastPath('magnetic field details')).toBe(true);
    });

    it('should detect simple yes/no questions', () => {
      expect(shouldUseFastPath('does earth have a magnetic field?')).toBe(true);
      expect(shouldUseFastPath('do satellites orbit the earth?')).toBe(true);
      expect(shouldUseFastPath('is aurora visible in summer?')).toBe(true);
    });

    it('should reject queries with complexity keywords', () => {
      expect(shouldUseFastPath('compare auroras on earth and mars')).toBe(false);
      expect(shouldUseFastPath('analyze aurora trends')).toBe(false);
      expect(shouldUseFastPath('evaluate the difference between X and Y')).toBe(false);
      expect(shouldUseFastPath('what is better: X or Y?')).toBe(false);
    });

    it('should reject queries with anti-patterns', () => {
      expect(shouldUseFastPath('what is X? and what is Y?')).toBe(false);
      expect(shouldUseFastPath('if I go to Alaska, when can I see auroras?')).toBe(false);
      expect(shouldUseFastPath('show me data compared to baseline')).toBe(false);
    });

    it('should reject causal reasoning queries', () => {
      expect(shouldUseFastPath('explain why auroras occur')).toBe(false);
      expect(shouldUseFastPath('what causes magnetic storms?')).toBe(false);
      expect(shouldUseFastPath('how does solar wind lead to auroras?')).toBe(false);
    });

    it('should reject multi-entity queries', () => {
      expect(shouldUseFastPath('what are auroras and geomagnetic storms?')).toBe(false);
      expect(shouldUseFastPath('show me either X or Y')).toBe(false);
      expect(shouldUseFastPath('list both satellites and planets')).toBe(false);
    });
  });

  describe('analyzeFastPath', () => {
    it('should provide detailed analysis with reasoning', () => {
      const result = analyzeFastPath('What is an aurora?');
      expect(result.useFastPath).toBe(true);
      expect(result.reason).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.patternMatched).toBeTruthy();
    });

    it('should explain rejection for complex queries', () => {
      const result = analyzeFastPath('compare auroras on earth and mars');
      expect(result.useFastPath).toBe(false);
      expect(result.reason).toContain('compare');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should handle edge cases gracefully', () => {
      const shortResult = analyzeFastPath('hi');
      expect(shortResult.useFastPath).toBe(false);
      expect(shortResult.reason).toContain('too short');

      const longResult = analyzeFastPath('a'.repeat(201));
      expect(longResult.useFastPath).toBe(false);
      expect(longResult.reason).toContain('too long');
    });

    it('should provide confidence scores', () => {
      const simpleResult = analyzeFastPath('What is X?');
      expect(simpleResult.confidence).toBeGreaterThanOrEqual(0.0);
      expect(simpleResult.confidence).toBeLessThanOrEqual(1.0);

      const complexResult = analyzeFastPath('analyze trends');
      expect(complexResult.confidence).toBeGreaterThanOrEqual(0.0);
      expect(complexResult.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Test Case Validation', () => {
    it('should pass all predefined test cases', () => {
      const failures: string[] = [];

      for (const testCase of FAST_PATH_TEST_CASES) {
        const result = shouldUseFastPath(testCase.query);
        if (result !== testCase.expected) {
          failures.push(
            `Query: "${testCase.query}"\n  Expected: ${testCase.expected}\n  Got: ${result}\n  Reason: ${testCase.reason}`
          );
        }
      }

      if (failures.length > 0) {
        console.error('Fast Path Test Failures:\n' + failures.join('\n\n'));
      }

      expect(failures).toHaveLength(0);
    });

    it('should have balanced test cases (both true and false)', () => {
      const trueCount = FAST_PATH_TEST_CASES.filter((tc) => tc.expected === true).length;
      const falseCount = FAST_PATH_TEST_CASES.filter((tc) => tc.expected === false).length;

      expect(trueCount).toBeGreaterThan(0);
      expect(falseCount).toBeGreaterThan(0);
      expect(trueCount).toBeGreaterThanOrEqual(5); // At least 5 true cases
      expect(falseCount).toBeGreaterThanOrEqual(5); // At least 5 false cases
    });
  });

  describe('Real-World Query Patterns', () => {
    it('should handle FAQ-style queries correctly', () => {
      expect(shouldUseFastPath('What is the capital of France?')).toBe(true);
      expect(shouldUseFastPath('Who invented the telephone?')).toBe(true);
      expect(shouldUseFastPath('When did World War 2 end?')).toBe(true);
    });

    it('should handle command-style queries correctly', () => {
      expect(shouldUseFastPath('Show me recent papers')).toBe(true);
      expect(shouldUseFastPath('Display user profile')).toBe(true);
      expect(shouldUseFastPath('Find all documents')).toBe(true);
    });

    it('should reject analytical queries', () => {
      expect(shouldUseFastPath('Analyze the relationship between X and Y')).toBe(false);
      expect(shouldUseFastPath('Evaluate the impact of policy changes')).toBe(false);
      expect(shouldUseFastPath('Assess the trend over time')).toBe(false);
    });

    it('should reject comparative queries', () => {
      expect(shouldUseFastPath('What is better: X or Y?')).toBe(false);
      expect(shouldUseFastPath('Compare the advantages of A versus B')).toBe(false);
      expect(shouldUseFastPath('Which is more effective?')).toBe(false);
    });

    it('should handle research-style queries appropriately', () => {
      // Simple lookups should pass
      expect(shouldUseFastPath('What is machine learning?')).toBe(true);

      // Complex research questions should fail
      expect(shouldUseFastPath('How has machine learning evolved over the past decade?')).toBe(false);
      expect(shouldUseFastPath('What are the implications of AI on society?')).toBe(false);
    });
  });

  describe('Edge Cases and Robustness', () => {
    it('should handle queries with extra whitespace', () => {
      expect(shouldUseFastPath('  what is an aurora?  ')).toBe(true);
      expect(shouldUseFastPath('show   me   data')).toBe(true);
    });

    it('should handle mixed case queries', () => {
      expect(shouldUseFastPath('WHAT IS AN AURORA?')).toBe(true);
      expect(shouldUseFastPath('Show Me Data')).toBe(true);
      expect(shouldUseFastPath('list ALL items')).toBe(true);
    });

    it('should handle queries with punctuation', () => {
      expect(shouldUseFastPath('What is an aurora?')).toBe(true);
      expect(shouldUseFastPath('What is an aurora')).toBe(true); // Without question mark
      expect(shouldUseFastPath('show me: data')).toBe(false); // Colon suggests structure
    });

    it('should handle queries with numbers', () => {
      expect(shouldUseFastPath('What is Document 123?')).toBe(true);
      expect(shouldUseFastPath('Show me item 42')).toBe(true);
    });

    it('should be consistent with repeated calls', () => {
      const query = 'What is an aurora?';
      const result1 = shouldUseFastPath(query);
      const result2 = shouldUseFastPath(query);
      const result3 = shouldUseFastPath(query);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });
});
