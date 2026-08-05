import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, getCrisisResources, resolveCrisisRegion } from './prompts.js';

describe('buildSystemPrompt', () => {
  it('includes the topic-lock instruction', () => {
    const prompt = buildSystemPrompt('en');
    expect(prompt).toContain('money, chores, and financial literacy');
    expect(prompt).toContain('never decide');
  });
});

describe('resolveCrisisRegion', () => {
  it('returns pl for pl locale regardless of currency', () => {
    expect(resolveCrisisRegion('pl', 'USD')).toBe('pl');
    expect(resolveCrisisRegion('pl', 'GBP')).toBe('pl');
    expect(resolveCrisisRegion('pl', null)).toBe('pl');
  });

  it('returns us for en locale with USD currency', () => {
    expect(resolveCrisisRegion('en', 'USD')).toBe('us');
  });

  it('returns uk for en locale with GBP currency', () => {
    expect(resolveCrisisRegion('en', 'GBP')).toBe('uk');
  });

  it('returns uk for en locale with null/missing currency (safe default)', () => {
    expect(resolveCrisisRegion('en', null)).toBe('uk');
    expect(resolveCrisisRegion('en', undefined)).toBe('uk');
  });
});

describe('getCrisisResources', () => {
  it('returns UK-oriented distress resources for uk region', () => {
    const res = getCrisisResources('uk', 'distress');
    expect(res.body).toContain('Childline');
  });

  it('returns Polish child-protection resources for pl region, abuse_pattern kind', () => {
    const res = getCrisisResources('pl', 'abuse_pattern');
    expect(res.body).toContain('116 111');
  });

  it('returns US distress resources containing 988', () => {
    const res = getCrisisResources('us', 'distress');
    expect(res.body).toContain('988');
  });

  it('returns US abuse_pattern resources containing the Childhelp number', () => {
    const res = getCrisisResources('us', 'abuse_pattern');
    expect(res.body).toContain('1-800-422-4453');
  });
});
