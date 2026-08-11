import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChildDashboard } from '../ChildDashboard'
import { LocaleProvider } from '../../lib/locale'
import * as api from '../../lib/api'

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

const requestPushPermissionMock = vi.fn().mockResolvedValue(true)
vi.mock('../../lib/push.js', () => ({
  requestPushPermission: (...args: unknown[]) => requestPushPermissionMock(...args),
  hasPromptedForPushPermission: () => localStorage.getItem('mc_push_permission_prompted') === '1',
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

const MOCK_CHORE = {
  id: 'chore1', family_id: 'fam1', assigned_to: 'user1', created_by: 'parent1',
  title: 'Tidy room', description: null, reward_amount: 100, currency: 'GBP',
  frequency: 'weekly', due_date: null, is_priority: 0, is_flash: 0,
  flash_deadline: null, archived: 0, proof_required: 0, auto_approve: 0,
  child_name: 'Kid', parent_name: 'Parent', created_at: 0, updated_at: 0,
}

describe('ChildDashboard — contextual push-permission prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    requestPushPermissionMock.mockClear()
    vi.mocked(api.getBalance).mockResolvedValue({
      earned: 0, pending: 0, reversals: 0, paid_out: 0, spent: 0, available: 0,
    } as never)
    vi.mocked(api.getGoals).mockResolvedValue({ goals: [] })
    vi.mocked(api.getCompletions).mockResolvedValue({ completions: [] })
    vi.mocked(api.getSettings).mockResolvedValue({
      avatar_id: '', theme: 'light', locale: 'en-GB', app_view: 'ORCHARD',
      earnings_mode: 'CHORES', allowance_amount: 0, allowance_frequency: 'WEEKLY',
    } as never)
    vi.mocked(api.getMyLockStatus).mockResolvedValue({ locked: false, locked_until: null })
  })

  it('requests push permission once the child has ≥1 assigned chore, and only once', async () => {
    vi.mocked(api.getChores).mockResolvedValue({ chores: [MOCK_CHORE] })
    renderDashboard('/child')
    await waitFor(() => expect(requestPushPermissionMock).toHaveBeenCalledTimes(1))
  })

  it('does not request push permission again once already prompted', async () => {
    localStorage.setItem('mc_push_permission_prompted', '1')
    vi.mocked(api.getChores).mockResolvedValue({ chores: [MOCK_CHORE] })
    renderDashboard('/child')
    await screen.findAllByText(/MOCK_(EARN|MONEY|GOALS|LAB)_TAB/)
    expect(requestPushPermissionMock).not.toHaveBeenCalled()
  })
})
