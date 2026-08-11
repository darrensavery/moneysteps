import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChoresTab } from './JobsTab'
import { LocaleProvider } from '../../lib/locale'
import type { ChildRecord } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  getChores: vi.fn().mockResolvedValue({ chores: [] }),
  archiveChore: vi.fn(),
  restoreChore: vi.fn(),
  getSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
  approveSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  getPlans: vi.fn().mockResolvedValue({ plans: [] }),
  createPlan: vi.fn(),
  deletePlan: vi.fn(),
  formatCurrency: (amount: number, currency: string) => `${currency} ${amount}`,
  getMondayISO: () => '2026-08-10',
}))

const requestPushPermissionMock = vi.fn().mockResolvedValue(true)
vi.mock('../../lib/push.js', () => ({
  requestPushPermission: (...args: unknown[]) => requestPushPermissionMock(...args),
  hasPromptedForPushPermission: () => localStorage.getItem('mc_push_permission_prompted') === '1',
}))

// CreateChoreSheet does its own API calls / form UI — stubbed to a single
// button that fires the same onCreated callback JobsTab wires up for real.
vi.mock('./CreateChoreSheet', () => ({
  CreateChoreSheet: ({ onCreated }: { onCreated: () => void }) => (
    <button onClick={onCreated}>MOCK_CREATE_CHORE_SAVE</button>
  ),
}))

const MOCK_CHILD: ChildRecord = {
  id: 'child1', display_name: 'Kid', avatar_id: null, locked_until: null,
  monzo_handle: null, revolut_handle: null, paypal_handle: null, venmo_handle: null,
}

function renderChoresTab() {
  return render(
    <LocaleProvider>
      <ChoresTab familyId="fam1" child={MOCK_CHILD} children={[MOCK_CHILD]} />
    </LocaleProvider>
  )
}

describe('ChoresTab — contextual push-permission prompt after first chore creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    requestPushPermissionMock.mockClear()
  })

  it('requests push permission after creating a chore', async () => {
    renderChoresTab()
    const addButton = await screen.findByText('+ Add first chore')
    await act(async () => { fireEvent.click(addButton) })
    const saveButton = await screen.findByText('MOCK_CREATE_CHORE_SAVE')
    await act(async () => { fireEvent.click(saveButton) })
    expect(requestPushPermissionMock).toHaveBeenCalledTimes(1)
  })

  it('does not request push permission again once already prompted', async () => {
    localStorage.setItem('mc_push_permission_prompted', '1')
    renderChoresTab()
    const addButton = await screen.findByText('+ Add first chore')
    await act(async () => { fireEvent.click(addButton) })
    const saveButton = await screen.findByText('MOCK_CREATE_CHORE_SAVE')
    await act(async () => { fireEvent.click(saveButton) })
    expect(requestPushPermissionMock).not.toHaveBeenCalled()
  })
})
