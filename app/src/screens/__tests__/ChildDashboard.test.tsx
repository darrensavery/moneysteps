import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChildDashboard } from '../ChildDashboard'
import { LocaleProvider } from '../../lib/locale'

// Deep-link query-param tab routing (Task 11b): push notifications land on
// /child?tab=<x> — the dashboard has no per-item sub-routes, so this test
// only asserts the RIGHT TAB becomes visible, not deep-linking to a specific
// item (explicit non-goal, see task-11b-brief.md).

vi.mock('../../lib/deviceIdentity', () => ({
  updateDeviceIdentity: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  getChores: vi.fn().mockResolvedValue({ chores: [] }),
  submitChore: vi.fn(),
  uploadProof: vi.fn(),
  getBalance: vi.fn().mockResolvedValue({
    earned: 0, pending: 0, reversals: 0, paid_out: 0, spent: 0, available: 0,
  }),
  getGoals: vi.fn().mockResolvedValue({ goals: [] }),
  getCompletions: vi.fn().mockResolvedValue({ completions: [] }),
  getSettings: vi.fn().mockResolvedValue({
    avatar_id: '', theme: 'light', locale: 'en-GB', app_view: 'ORCHARD',
    earnings_mode: 'CHORES', allowance_amount: 0, allowance_frequency: 'WEEKLY',
  }),
  updateSettings: vi.fn(),
  getMyLockStatus: vi.fn().mockResolvedValue({ locked: false, locked_until: null }),
  getFamilyId: () => 'fam1',
  getUserId: () => 'user1',
  formatCurrency: (amount: number, currency: string) => `${currency} ${amount}`,
  purchaseGoal: vi.fn(),
  effectiveTarget: vi.fn(),
  apiUrl: (p: string) => p,
  authHeaders: vi.fn().mockRejectedValue(new Error('not needed in test')),
  getChildNudges: vi.fn().mockRejectedValue(new Error('not needed in test')),
  getLabModules: vi.fn().mockResolvedValue({ modules: {} }),
}))

// Tab-content components — stubbed so the dashboard mounts without pulling
// in their own API calls. Each stub renders identifiable text so visibility
// can be asserted via the wrapping `.tab-panel` element.
vi.mock('../../components/dashboard/EarnTab', () => ({
  EarnTab: () => <div>MOCK_EARN_TAB</div>,
}))
vi.mock('../../components/dashboard/LabTab', () => ({
  LabTab: () => <div>MOCK_LAB_TAB</div>,
}))
vi.mock('../../components/dashboard/ChildMoneyTab', () => ({
  ChildMoneyTab: () => <div>MOCK_MONEY_TAB</div>,
}))
vi.mock('../../components/dashboard/ChildGoalsTab', () => ({
  ChildGoalsTab: () => <div>MOCK_GOALS_TAB</div>,
}))

function renderDashboard(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocaleProvider>
        <Routes>
          <Route path="/child" element={<ChildDashboard />} />
        </Routes>
      </LocaleProvider>
    </MemoryRouter>
  )
}

describe('ChildDashboard — ?tab= query param deep-link routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('defaults to the home tab when no ?tab= param is present', async () => {
    renderDashboard('/child')
    // Home tab is conditionally MOUNTED (not just hidden) — its absence and
    // the other tabs staying hidden together prove 'home' won.
    const panels = await screen.findAllByText(/MOCK_(EARN|MONEY|GOALS|LAB)_TAB/)
    for (const p of panels) {
      expect(p.closest('.tab-panel')?.className).toContain('hidden')
    }
  })

  it('renders the goals tab as initially visible for /child?tab=goals', async () => {
    renderDashboard('/child?tab=goals')
    const goalsMock = await screen.findByText('MOCK_GOALS_TAB')
    expect(goalsMock.closest('.tab-panel')?.className).not.toContain('hidden')

    const moneyMock = screen.getByText('MOCK_MONEY_TAB')
    expect(moneyMock.closest('.tab-panel')?.className).toContain('hidden')
  })

  it('ignores an invalid ?tab= value and falls back to home', async () => {
    renderDashboard('/child?tab=not-a-real-tab')
    const panels = await screen.findAllByText(/MOCK_(EARN|MONEY|GOALS|LAB)_TAB/)
    for (const p of panels) {
      expect(p.closest('.tab-panel')?.className).toContain('hidden')
    }
  })
})
