import { describe, it, expect, vi } from 'vitest';
import { notifyParentsOfDistress } from './alerts.js';

vi.mock('../email.js', () => {
  const mockSendTransactional = vi.fn().mockResolvedValue(undefined);

  class MockEmailService {
    constructor(env: any) {}
    sendTransactional = mockSendTransactional;
  }

  return {
    EmailService: MockEmailService,
    __mockSendTransactional: mockSendTransactional,
  };
});

function makeEnv() {
  const all = vi.fn().mockResolvedValue({
    results: [{ email: 'parent1@example.com' }, { email: 'parent2@example.com' }],
  });
  const bind = vi.fn().mockReturnValue({ all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { DB: { prepare } } as any;
}

describe('notifyParentsOfDistress', () => {
  it('sends to every parent email in the family', async () => {
    const env = makeEnv();
    const { __mockSendTransactional } = await import('../email.js') as unknown as { __mockSendTransactional: ReturnType<typeof vi.fn> };
    __mockSendTransactional.mockClear();
    await notifyParentsOfDistress(env, { familyId: 'fam_1', childDisplayName: 'Robin', locale: 'en' });
    expect(__mockSendTransactional).toHaveBeenCalledTimes(2);
  });
});
