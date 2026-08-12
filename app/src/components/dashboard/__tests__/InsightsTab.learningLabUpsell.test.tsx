import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { InsightsTab } from '../InsightsTab'
import * as api from '../../../lib/api'
import type { ChildRecord, InsightsData, TrialStatus } from '../../../lib/api'

afterEach(() => vi.restoreAllMocks())

const child: ChildRecord = {
  id: 'c1', display_name: 'Ellie', avatar_id: 'a1',
} as ChildRecord

const baseData: InsightsData = {
  period: 'month', period_start_epoch: null,
  is_discovery_phase: false, is_demo: false,
  learning_lab_enabled: false,
  current_module: null, completed_module_slugs: [], retention_score: null,
  mentor_briefing: null, discovery_briefing: null,
  sparkline_points: null,
} as unknown as InsightsData

function trial(overrides: Partial<TrialStatus>): TrialStatus {
  return {
    is_activated: true, days_remaining: 0, is_expired: true,
    has_lifetime_license: true, has_ai_mentor: false, has_shield: false,
    ...overrides,
  }
}

describe('InsightsTab — Learning Lab upsell', () => {
  it('shows the upsell card for a post-trial Core-only family', async () => {
    vi.spyOn(api, 'getInsights').mockResolvedValue(baseData)
    vi.spyOn(api, 'getChildNudges').mockResolvedValue({ nudges: { earn: null, money: null, goals: null } } as never)

    render(
      <InsightsTab
        familyId="fam1"
        child={child}
        children={[child]}
        trialStatus={trial({})}
        onUpgrade={() => {}}
      />,
    )

    await waitFor(() => expect(screen.getByText('Unlock Learning Lab for Ellie')).toBeTruthy())
  })

  it('does not show the upsell card while the trial is still active', async () => {
    vi.spyOn(api, 'getInsights').mockResolvedValue(baseData)
    vi.spyOn(api, 'getChildNudges').mockResolvedValue({ nudges: { earn: null, money: null, goals: null } } as never)

    render(
      <InsightsTab
        familyId="fam1"
        child={child}
        children={[child]}
        trialStatus={trial({ is_expired: false })}
        onUpgrade={() => {}}
      />,
    )

    // Wait for a guaranteed-rendered element (the Responsibility sparkline
    // label) before asserting absence — otherwise the negative assertion
    // could pass during the loading state, before data ever resolves.
    await waitFor(() => expect(screen.getByText('Responsibility')).toBeTruthy())
    expect(screen.queryByText('Unlock Learning Lab for Ellie')).toBeNull()
  })
})
