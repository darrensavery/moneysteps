import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ParentDashboard } from '../ParentDashboard'
import { LocaleProvider } from '../../lib/locale'
import * as api from '../../lib/api'
import type { ChildRecord } from '../../lib/api'

// ParentDashboard renders `v{__APP_VERSION__}` (footer of the settings
// drawer) from a Vite `define` global that only exists in real builds.
;(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test'

// Deep-link query-param tab routing (Task 11b): push notifications land on
// /parent?tab=<x> — the dashboard has no per-item sub-routes, so this test
// only asserts the RIGHT TAB becomes visible, not deep-linking to a specific
// item (explicit non-goal, see task-11b-brief.md).

vi.mock('../../lib/deviceIdentity', () => ({
  getDeviceIdentity: () => ({
    user_id: 'parent1', family_id: 'fam1', display_name: 'Dana',
    role: 'parent', parenting_role: 'LEAD_PARENT', initials: 'D',
    registered_at: '2026-01-01T00:00:00.000Z', auth_method: 'none',
  }),
}))

vi.mock('../../lib/api', () => ({
  getChildren: vi.fn(),
  getCompletions: vi.fn(),
  clearToken: vi.fn(),
  getUnpaidSummary: vi.fn(),
  getFamily: vi.fn(),
  getTrialStatus: vi.fn(),
  authHeaders: vi.fn(),
  apiUrl: (p: string) => p,
}))

// Heavy tab-content components — stubbed so the dashboard mounts without
// pulling in their own API calls. Each stub renders identifiable text so
// visibility can be asserted via the wrapping `.tab-panel` element.
vi.mock('../../components/dashboard/JobsTab', () => ({
  ChoresTab: () => <div>MOCK_CHORES_TAB</div>,
}))
vi.mock('../../components/dashboard/HistoryTab', () => ({
  ActivityTab: () => <div>MOCK_ACTIVITY_TAB</div>,
}))
vi.mock('../../components/dashboard/InsightsTab', () => ({
  InsightsTab: () => <div>MOCK_INSIGHTS_TAB</div>,
}))
vi.mock('../../components/dashboard/GoalBoostingTab', () => ({
  GoalBoostingTab: () => <div>MOCK_GOALS_TAB</div>,
}))
vi.mock('../../components/dashboard/PoolTab', () => ({
  PoolTab: () => <div>MOCK_POOL_TAB</div>,
}))
vi.mock('../../components/dashboard/GiveRequestsPanel', () => ({
  GiveRequestsPanel: () => <div>MOCK_GIVE_REQUESTS</div>,
}))
vi.mock('../../components/dashboard/ParentSettingsTab', () => ({
  ParentSettingsTab: () => <div>MOCK_SETTINGS</div>,
}))
vi.mock('../../components/demo/DemoBanner', () => ({
  DemoBanner: () => null,
}))
vi.mock('../../components/demo/DemoUpsellCard', () => ({
  DemoUpsellCard: () => null,
}))
vi.mock('../../components/payment/PaymentBridgeSheet', () => ({
  PaymentBridgeSheet: () => null,
}))

const child: ChildRecord = {
  id: 'child1', display_name: 'Henry', avatar_id: null, locked_until: null,
  monzo_handle: null, revolut_handle: null, paypal_handle: null, venmo_handle: null,
}

function renderDashboard(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocaleProvider>
        <Routes>
          <Route path="/parent" element={<ParentDashboard />} />
        </Routes>
      </LocaleProvider>
    </MemoryRouter>
  )
}

describe('ParentDashboard — ?tab= query param deep-link routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(api.getChildren).mockResolvedValue({ children: [child] })
    vi.mocked(api.getCompletions).mockResolvedValue({ completions: [] })
    vi.mocked(api.getUnpaidSummary).mockResolvedValue({ children: [] })
    vi.mocked(api.getFamily).mockResolvedValue({ parenting_mode: 'single' })
    vi.mocked(api.getTrialStatus).mockResolvedValue({} as never)
    vi.mocked(api.authHeaders).mockResolvedValue({})
  })

  it('defaults to the chores tab when no ?tab= param is present', async () => {
    renderDashboard('/parent')
    await screen.findByText('MOCK_CHORES_TAB')

    const panels = document.querySelectorAll('.tab-panel')
    expect(panels[0].className).not.toContain('hidden')   // chores — visible
    expect(panels[1].className).toContain('hidden')       // activity — hidden
  })

  it('renders the activity tab as initially visible for /parent?tab=activity', async () => {
    renderDashboard('/parent?tab=activity')
    await screen.findByText('MOCK_ACTIVITY_TAB')

    const panels = document.querySelectorAll('.tab-panel')
    expect(panels[0].className).toContain('hidden')       // chores — hidden
    expect(panels[1].className).not.toContain('hidden')   // activity — visible
  })

  it('ignores an invalid ?tab= value and falls back to chores', async () => {
    renderDashboard('/parent?tab=not-a-real-tab')
    await screen.findByText('MOCK_CHORES_TAB')

    const panels = document.querySelectorAll('.tab-panel')
    expect(panels[0].className).not.toContain('hidden')
  })

  it('persists the query-param-selected tab to localStorage', async () => {
    renderDashboard('/parent?tab=pool')
    await screen.findByText('MOCK_POOL_TAB')

    expect(localStorage.getItem('mc_parent_tab')).toBe('pool')
  })
})
