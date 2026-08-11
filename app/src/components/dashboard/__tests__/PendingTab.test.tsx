import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PendingTab } from '../PendingTab'
import * as api from '../../../lib/api'
import type { Completion, ChildRecord } from '../../../lib/api'

vi.mock('../../../lib/api', () => ({
  getCompletions: vi.fn(),
  approveCompletion: vi.fn(),
  reviseCompletion: vi.fn(),
  approveAll: vi.fn(),
  getProofUrl: vi.fn().mockResolvedValue({ url: 'https://example.com/proof.jpg' }),
  formatCurrency: (amount: number, currency: string) =>
    `${currency === 'GBP' ? '£' : currency} ${(amount / 100).toFixed(2)}`,
}))

const child: ChildRecord = {
  id: 'child1', display_name: 'Henry', avatar_id: null, locked_until: null,
  monzo_handle: null, revolut_handle: null, paypal_handle: null, venmo_handle: null,
}

const completion: Completion = {
  id: 'comp1', chore_id: 'chore1', child_id: 'child1', child_name: 'Henry',
  chore_title: 'Wash the car', reward_amount: 500, currency: 'GBP',
  note: null, rejection_note: null, parent_notes: null,
  proof_url: null, proof_exif: null, system_verify: null,
  attempt_count: 1, status: 'awaiting_review',
  rating: 0, submitted_at: 1_700_000_000, resolved_at: null,
  paid_out_at: null,
}

function renderPendingTab() {
  return render(
    <MemoryRouter>
      <PendingTab familyId="fam1" child={child} onCountChange={() => {}} />
    </MemoryRouter>
  )
}

describe('PendingTab — co-parent "already approved" race guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a friendly toast and refreshes the list when approving a completion the other parent already resolved', async () => {
    vi.mocked(api.getCompletions)
      .mockResolvedValueOnce({ completions: [completion] })
      .mockResolvedValueOnce({ completions: [] }) // co-parent already approved it — refetch is empty
    vi.mocked(api.approveCompletion).mockRejectedValue(
      new Error('Cannot approve — completion is no longer awaiting review')
    )

    renderPendingTab()
    await screen.findByText('Wash the car')

    fireEvent.click(screen.getByText('Approve ✓'))

    await waitFor(() => expect(screen.getByText(/Already actioned by the other parent/)).toBeTruthy())
    // List refreshed and the stale card is gone — "All clear" empty state shown.
    await waitFor(() => expect(screen.getByText('All clear')).toBeTruthy())
    expect(api.getCompletions).toHaveBeenCalledTimes(2)
  })

  it('shows the normal approved toast and does not treat unrelated errors as an already-resolved race', async () => {
    vi.mocked(api.getCompletions).mockResolvedValue({ completions: [completion] })
    vi.mocked(api.approveCompletion).mockRejectedValue(new Error('Network error'))

    renderPendingTab()
    await screen.findByText('Wash the car')

    fireEvent.click(screen.getByText('Approve ✓'))

    await waitFor(() => expect(screen.getByText(/Something went wrong — please try again\./)).toBeTruthy())
    // Card stays — this wasn't a resolved-race, so we didn't force a refetch/dismiss.
    expect(screen.getByText('Wash the car')).toBeTruthy()
  })

  it('approves successfully and shows the approved toast on the happy path', async () => {
    vi.mocked(api.getCompletions)
      .mockResolvedValueOnce({ completions: [completion] })
      .mockResolvedValueOnce({ completions: [] })
    vi.mocked(api.approveCompletion).mockResolvedValue({
      ledger_id: 1, amount: 500, currency: 'GBP', show_review_prompt: false,
    })

    renderPendingTab()
    await screen.findByText('Wash the car')

    fireEvent.click(screen.getByText('Approve ✓'))

    await waitFor(() => expect(screen.getByText(/Approved ✓/)).toBeTruthy())
  })
})
