import { describe, expect, test } from 'vitest';
import {
  monzoUrl, revolutUrl, paypalUrl, venmoUrl, buildReference,
} from './paymentBridge';

describe('monzoUrl', () => {
  test('builds well-formed URL', () => {
    expect(monzoUrl('alexj', '5.00')).toBe('https://monzo.me/alexj/5.00');
  });
  test('returns null when handle missing', () => {
    expect(monzoUrl('', '5.00')).toBeNull();
  });
  test('encodes handles with special chars', () => {
    expect(monzoUrl('alex j', '5.00')).toBe('https://monzo.me/alex%20j/5.00');
  });
});

describe('revolutUrl', () => {
  test('builds well-formed URL', () => {
    expect(revolutUrl('alexj', '5.00')).toBe('https://revolut.me/alexj/5.00');
  });
  test('returns null when handle missing', () => {
    expect(revolutUrl('', '5.00')).toBeNull();
  });
});

describe('paypalUrl', () => {
  test('appends currency code', () => {
    expect(paypalUrl('alexj', '5.00', 'GBP')).toBe('https://paypal.me/alexj/5.00GBP');
  });
  test('supports USD', () => {
    expect(paypalUrl('alexj', '5.00', 'USD')).toBe('https://paypal.me/alexj/5.00USD');
  });
  test('returns null when handle missing', () => {
    expect(paypalUrl('', '5.00', 'GBP')).toBeNull();
  });
});

describe('venmoUrl', () => {
  test('builds deep-link with txn, recipients, amount, note', () => {
    const url = venmoUrl('alexj', '5.00', 'MC Alex 22APR');
    expect(url).toMatch(/^venmo:\/\/paycharge\?/);
    expect(url).toContain('txn=pay');
    expect(url).toContain('recipients=alexj');
    expect(url).toContain('amount=5.00');
    expect(url).toContain('note=MC+Alex+22APR');
  });
});

describe('buildReference', () => {
  test('formats "MC <Name> <DDMMM>"', () => {
    const d = new Date('2026-04-22T12:00:00Z');
    expect(buildReference('Alex', d)).toBe('MC Alex 22APR');
  });
  test('truncates long names to fit 18-char cap', () => {
    const d = new Date('2026-04-22T12:00:00Z');
    const ref = buildReference('Maximilianus', d);
    expect(ref.length).toBeLessThanOrEqual(18);
    expect(ref).toMatch(/^MC Maximilia.*22APR$/);
  });
  test('strips non-alphanumeric chars from name', () => {
    const d = new Date('2026-04-22T12:00:00Z');
    expect(buildReference("O'Brien", d)).toBe('MC OBrien 22APR');
  });
  test('pads single-digit days', () => {
    const d = new Date('2026-04-05T12:00:00Z');
    expect(buildReference('Alex', d)).toBe('MC Alex 05APR');
  });
});
