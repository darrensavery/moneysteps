/**
 * Stage 3 — Child Onboarding (Privacy-First)
 *
 * - Collects child display name (nickname recommended)
 * - Calls POST /auth/child/add → returns 6-digit invite code
 * - Shows code with Copy button + sharing instructions
 * - Multiple children can be added; at least one is required to proceed
 */

import { useEffect, useRef, useState } from 'react'
import { UserPlus, Copy, Check, ShieldCheck, ChevronRight, Baby } from 'lucide-react'
import { Button }                              from '@/components/ui/button'
import { Input }                               from '@/components/ui/input'
import { Label }                               from '@/components/ui/label'
import { Alert, AlertDescription }             from '@/components/ui/alert'
import { Badge }                               from '@/components/ui/badge'
import { addChild }                            from '@/lib/api'
import { cn }                                  from '@/lib/utils'
import type { RegistrationState, ChildRecord } from './RegistrationShell'

interface Props {
  data: RegistrationState
  onNext: (patch: Partial<RegistrationState>) => void
  onBack: () => void
}

export function Stage3ChildOnboarding({ data, onNext, onBack }: Props) {
  const [children,     setChildren]     = useState<ChildRecord[]>(data.children ?? [])
  const [nickname,     setNickname]     = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [justAdded,    setJustAdded]    = useState<ChildRecord | null>(null)
  const [copiedCode,   setCopiedCode]   = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  async function handleAddChild() {
    const name = nickname.trim()
    if (!name) { setError('Enter a name or nickname first'); return }
    setError('')
    setLoading(true)
    try {
      const result = await addChild(name, 'HYBRID')
      const child: ChildRecord = {
        child_id:    result.child_id,
        display_name: name,
        invite_code: result.invite_code,
        expires_at:  (result as { child_id: string; invite_code: string; expires_at?: number }).expires_at ?? 0,
      }
      setChildren(prev => [...prev, child])
      setJustAdded(child)
      setNickname('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add child')
    } finally {
      setLoading(false)
    }
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2500)
  }

  function handleNext() {
    if (children.length === 0) {
      setError('Add at least one child to continue')
      return
    }
    onNext({ children })
  }

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="space-y-1">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">Child Onboarding</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Add each child to your family record. They join on their own device using
          the secure code you generate here.
        </p>
      </div>

      {/* Privacy disclaimer */}
      <Alert variant="info">
        <ShieldCheck size={15} />
        <AlertDescription>
          <span className="font-semibold">Privacy-first: </span>
          To protect your child's privacy, we recommend using a nickname or first name only.
          Avoid using full legal names. The display name is used across all AI coaching.
        </AlertDescription>
      </Alert>

      {/* Add child form */}
      <div className="space-y-3">
        <Label htmlFor="nickname">Child's display name or nickname</Label>
        <div className="flex gap-2">
          <Input
            id="nickname"
            placeholder="e.g. Lily, Max, Kacper"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddChild()}
            required
            aria-required="true"
            aria-invalid={!!error}
            aria-describedby={error ? 'nickname-error' : undefined}
            className="flex-1"
          />
          <Button
            onClick={handleAddChild}
            disabled={loading || !nickname.trim()}
            className="shrink-0 gap-1.5"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <UserPlus size={16} />
            )}
            Add
          </Button>
        </div>
        {error && <p id="nickname-error" role="alert" className="text-xs text-destructive font-medium">{error}</p>}
      </div>

      {/* Freshly-generated code display */}
      {justAdded && (
        <InviteCodeCard
          child={justAdded}
          onCopy={copyCode}
          copied={copiedCode === justAdded.invite_code}
          onDismiss={() => setJustAdded(null)}
        />
      )}

      {/* Children added so far */}
      {children.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">
            Added ({children.length})
          </p>
          <div className="space-y-2">
            {children.map(child => (
              <div
                key={child.child_id}
                className="flex items-center justify-between rounded-xl border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-teal-100 p-2">
                    <Baby size={14} className="text-teal-700" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{child.display_name}</p>
                    <p className="text-xs text-muted-foreground font-mono tracking-widest">
                      {child.invite_code}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">Invite ready</Badge>
                  <button
                    type="button"
                    onClick={() => copyCode(child.invite_code)}
                    className="tap-target-44 p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                    aria-label="Copy invite code"
                  >
                    {copiedCode === child.invite_code
                      ? <Check size={14} className="text-green-600" />
                      : <Copy size={14} />
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-1">
        <Button variant="outline" className="flex-1 h-12" onClick={onBack}>
          Back
        </Button>
        <Button
          className="flex-[2] h-12 text-base"
          onClick={handleNext}
          disabled={children.length === 0}
        >
          {data.parenting_mode === 'co-parenting'
            ? 'Continue — Co-Parent Bridge'
            : 'Complete Setup'}
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  )
}

// ── Invite code card (shown immediately after child is added) ─────────────────

function InviteCodeCard({
  child, onCopy, copied, onDismiss,
}: {
  child: ChildRecord
  onCopy: (code: string) => void
  copied: boolean
  onDismiss: () => void
}) {
  return (
    <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-sm">Invite code for {child.display_name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Give this code to {child.display_name} so they can link their device.
            Valid for 72 hours.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {/* The code */}
      <div className="flex items-center justify-center">
        <span
          className={cn(
            'font-mono text-4xl font-extrabold tracking-[0.4em] tabular-nums',
            'bg-white rounded-xl px-6 py-3 border border-primary/20 select-all',
          )}
        >
          {child.invite_code}
        </span>
      </div>

      <Button
        variant="outline"
        className="w-full gap-2 border-primary/30 hover:bg-primary/10"
        onClick={() => onCopy(child.invite_code)}
      >
        {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
        {copied ? 'Copied!' : 'Copy to Clipboard'}
      </Button>

      <p className="text-xs text-center text-muted-foreground">
        On {child.display_name}'s device → tap <strong>Join Family</strong> → enter this code
      </p>
    </div>
  )
}
