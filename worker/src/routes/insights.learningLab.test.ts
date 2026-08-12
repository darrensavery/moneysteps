import { describe, it, expect } from 'vitest';
import { computeLearningLabEnabled } from './insights.js';

describe('computeLearningLabEnabled', () => {
  it('is false for a Core-only family (no ai_mentor, no shield)', () => {
    expect(computeLearningLabEnabled({ has_ai_mentor: 0, has_shield: 0 })).toBe(false);
  });

  it('is true when has_ai_mentor is set', () => {
    expect(computeLearningLabEnabled({ has_ai_mentor: 1, has_shield: 0 })).toBe(true);
  });

  it('is true when has_shield is set', () => {
    expect(computeLearningLabEnabled({ has_ai_mentor: 0, has_shield: 1 })).toBe(true);
  });

  it('is false when the family row could not be loaded', () => {
    expect(computeLearningLabEnabled(null)).toBe(false);
  });
});
