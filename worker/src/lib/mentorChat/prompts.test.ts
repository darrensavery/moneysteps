import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, getCrisisResources } from './prompts.js';

describe('buildSystemPrompt', () => {
  it('includes the topic-lock instruction', () => {
    const prompt = buildSystemPrompt('en');
    expect(prompt).toContain('money, chores, and financial literacy');
    expect(prompt).toContain('never decide');
  });
});

describe('getCrisisResources', () => {
  it('returns UK-oriented distress resources for en locale', () => {
    const res = getCrisisResources('en', 'distress');
    expect(res.body).toContain('Childline');
  });

  it('returns Polish child-protection resources for pl locale, abuse_pattern kind', () => {
    const res = getCrisisResources('pl', 'abuse_pattern');
    expect(res.body).toContain('116 111');
  });
});
