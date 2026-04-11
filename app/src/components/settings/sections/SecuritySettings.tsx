/**
 * SecuritySettings — Security & Access router.
 * Owns sub-screen view state and handles deep-link ?view=pin or ?view=sessions.
 */

import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Lock, Eye } from 'lucide-react'
import type { MeResult } from '../../../lib/api'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import { PinManagementSettings }   from './PinManagementSettings'
import { ActiveSessionsSettings }  from './ActiveSessionsSettings'

type SecurityView = 'menu' | 'pin' | 'sessions'

interface Props {
  profile:      MeResult | null
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

export function SecuritySettings({ profile, toast, onBack, onComingSoon }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<SecurityView>('menu')

  // Handle deep-link: /parent?settings=security&view=pin
  useEffect(() => {
    const v = searchParams.get('view')
    if (v === 'pin' || v === 'sessions') {
      setView(v)
      // Clean the query params so navigating back works cleanly
      setSearchParams({}, { replace: true })
    }
  }, [])

  if (view === 'pin') {
    return (
      <PinManagementSettings
        profile={profile}
        onBack={() => setView('menu')}
      />
    )
  }

  if (view === 'sessions') {
    return (
      <ActiveSessionsSettings
        onBack={() => setView('menu')}
      />
    )
  }

  // Menu
  const hasPinSetup = profile?.has_pin ?? false
  const hasPassword = profile?.has_password ?? false

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Security & Access" onBack={onBack} />
      <SectionCard>
        <SettingsRow
          icon={<Lock size={15} />}
          label={hasPassword ? 'PIN Management' : 'Set a Password First'}
          description={
            hasPassword
              ? hasPinSetup
                ? 'Change or reset your parent PIN'
                : 'Set up a 4-digit parent PIN'
              : 'A password is required before setting a PIN'
          }
          onClick={hasPassword ? () => setView('pin') : onComingSoon}
        />
        <SettingsRow
          icon={<Eye size={15} />}
          label="Active Sessions"
          description="View and log out of all devices accessing the Family Orchard"
          onClick={() => setView('sessions')}
        />
      </SectionCard>
    </div>
  )
}
