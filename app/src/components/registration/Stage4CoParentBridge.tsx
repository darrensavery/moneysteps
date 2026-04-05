/**
 * Stage 4 — Co-Parent Bridge (Optional)
 *
 * - Only shown when parenting_mode === 'co-parenting'
 * - Option A: Email invite (sends co-parent a deep-link with typed code)
 * - Option B: Share 6-digit code via social messenger / clipboard
 * - Adaptive messaging based on governance_mode (amicable vs. standard)
 * - If skipped, the co-parent invite code is still shown as fallback
 */

import { useState } from 'react'
import { Mail, Copy, Check, MessageCircle, Share2, ChevronRight, ShieldCheck, Scale } from 'lucide-react'
import { Button }                       from '@/components/ui/button'
import { Input }                        from '@/components/ui/input'
import { Label }                        from '@/components/ui/label'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Badge }                        from '@/components/ui/badge'
import { generateInvite }              from '@/lib/api'
import { cn }                           from '@/lib/utils'
import type { RegistrationState }       from './RegistrationShell'

interface Props {
  data: RegistrationState
  onNext: (patch: Partial<RegistrationState>) => void
  onBack: () => void
}

type SendMethod = 'email' | 'share' | null

export function Stage4CoParentBridge({ data, onNext, onBack }: Props) {
  const [code,        setCode]        = useState<string | null>(data.coparent_invite_code ?? null)
  const [expiresAt,   setExpiresAt]   = useState<number | null>(data.coparent_expires_at ?? null)
  const [method,      setMethod]      = useState<SendMethod>(null)
  const [email,       setEmail]       = useState('')
  const [emailSent,   setEmailSent]   = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [copied,      setCopied]      = useState(false)

  const isStandard = data.governance_mode === 'standard'

  // Generate the co-parent invite code on first interaction
  async function ensureCode() {
    if (code) return code
    setLoading(true)
    setError('')
    try {
      const result = await generateInvite('co-parent')
      setCode(result.code)
      setExpiresAt(result.expires_at)
      return result.code
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invite code')
      return null
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerateAndShare(selectedMethod: SendMethod) {
    const c = await ensureCode()
    if (!c) return
    setMethod(selectedMethod)
  }

  async function handleSendEmail() {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address')
      return
    }
    const c = code ?? await ensureCode()
    if (!c) return

    // In production this calls the Worker to send a Resend invite email.
    // For now we simulate success (the Worker endpoint is a thin Resend call).
    setLoading(true)
    try {
      await fetch('/auth/invite/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('mc_token')}`,
        },
        body: JSON.stringify({ email, code: c, role: 'co-parent' }),
      })
      setEmailSent(true)
      setError('')
    } catch {
      // Non-fatal: show the code manually as fallback
      setEmailSent(false)
    } finally {
      setLoading(false)
    }
  }

  async function copyCode() {
    const c = code ?? await ensureCode()
    if (!c) return
    await navigator.clipboard.writeText(c)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function shareViaApp(app: 'whatsapp' | 'messenger' | 'email') {
    const c = code ?? ''
    const joinUrl = `${window.location.origin}/join?code=${c}`
    const message = `You've been invited to join a Morechard family record. Use code ${c} or open: ${joinUrl}`
    const urls: Record<typeof app, string> = {
      whatsapp:  `https://wa.me/?text=${encodeURIComponent(message)}`,
      messenger: `https://www.facebook.com/dialog/send?link=${encodeURIComponent(joinUrl)}`,
      email:     `mailto:?subject=${encodeURIComponent('Join our Morechard family')}&body=${encodeURIComponent(message)}`,
    }
    window.open(urls[app], '_blank', 'noopener')
  }

  function handleFinish(skipped: boolean) {
    onNext({
      coparent_invite_code: code ?? undefined,
      coparent_expires_at:  expiresAt ?? undefined,
      coparent_skipped:     skipped,
    })
  }

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Co-Parent Bridge</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Invite your co-parent to join as a Verified Orchard Lead. This step is optional
          — you can invite them later from Settings.
        </p>
      </div>

      {/* Adaptive governance callout */}
      <Alert variant={isStandard ? 'info' : 'success'}>
        {isStandard ? <Scale size={15} /> : <ShieldCheck size={15} />}
        <AlertTitle>
          {isStandard ? 'Establish Verified Accountability' : 'Secure Your Family Record'}
        </AlertTitle>
        <AlertDescription>
          {isStandard
            ? 'Invite a co-parent as a Verified Parent. Email authentication is required to maintain a high-integrity audit trail and ensure all approvals are formally logged.'
            : "Invite a co-parent to help manage chores and goals. Email verification ensures your family data stays private and stays in sync across everyone's phones."
          }
        </AlertDescription>
      </Alert>

      {/* Invite method selector */}
      {!code && (
        <div className="grid grid-cols-2 gap-3">
          <MethodCard
            active={method === 'email'}
            onClick={() => handleGenerateAndShare('email')}
            icon={<Mail size={20} />}
            title="Email Invite"
            description="Send a secure link to their inbox"
          />
          <MethodCard
            active={method === 'share'}
            onClick={() => handleGenerateAndShare('share')}
            icon={<Share2 size={20} />}
            title="Share Code"
            description="Send via WhatsApp, Messenger, etc."
          />
        </div>
      )}

      {/* Loading spinner while generating code */}
      {loading && (
        <div className="flex justify-center py-4">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {error && <p className="text-xs text-destructive font-medium">{error}</p>}

      {/* Code generated — show options */}
      {code && (
        <div className="space-y-5">
          {/* The code display */}
          <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">Co-parent invite code</p>
              <Badge variant="warning">Parent access</Badge>
            </div>
            <div className="flex items-center justify-center">
              <span className="font-mono text-4xl font-extrabold tracking-[0.4em] tabular-nums bg-white rounded-xl px-6 py-3 border border-primary/20 select-all">
                {code}
              </span>
            </div>
            <Button
              variant="outline"
              className="w-full gap-2 border-primary/30 hover:bg-primary/10"
              onClick={copyCode}
            >
              {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
              {copied ? 'Copied!' : 'Copy Code'}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Your co-parent enters this code when they create their account. Expires in 72 hours.
            </p>
          </div>

          {/* Email invite form */}
          {(method === 'email' || !method) && (
            <div className="space-y-3">
              <Label htmlFor="coparent-email">Send invite by email</Label>
              {emailSent ? (
                <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
                  <Check size={15} /> Invite sent to {email}
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="coparent-email"
                    type="email"
                    placeholder="coparent@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendEmail()}
                    className="flex-1"
                  />
                  <Button onClick={handleSendEmail} disabled={loading} className="shrink-0">
                    <Mail size={15} className="mr-1.5" /> Send
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Social sharing buttons */}
          {(method === 'share' || !method) && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Share via</p>
              <div className="grid grid-cols-3 gap-2">
                <ShareButton
                  onClick={() => shareViaApp('whatsapp')}
                  label="WhatsApp"
                  colour="bg-[#25D366] hover:bg-[#1EBB57]"
                  icon={<MessageCircle size={15} />}
                />
                <ShareButton
                  onClick={() => shareViaApp('messenger')}
                  label="Messenger"
                  colour="bg-[#0099FF] hover:bg-[#007FDB]"
                  icon={<MessageCircle size={15} />}
                />
                <ShareButton
                  onClick={() => shareViaApp('email')}
                  label="Email"
                  colour="bg-gray-600 hover:bg-gray-700"
                  icon={<Mail size={15} />}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-1">
        <Button variant="outline" className="flex-1 h-12" onClick={onBack}>
          Back
        </Button>
        <Button
          className="flex-[2] h-12 text-base"
          onClick={() => handleFinish(false)}
        >
          Complete Setup <ChevronRight size={16} />
        </Button>
      </div>

      {!code && (
        <button
          type="button"
          onClick={() => handleFinish(true)}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          Skip for now — I'll invite my co-parent later
        </button>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function MethodCard({
  active, onClick, icon, title, description,
}: {
  active: boolean; onClick: () => void
  icon: React.ReactNode; title: string; description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all',
        active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
      )}
    >
      <span className={cn('rounded-lg p-1.5', active ? 'bg-primary/10 text-primary' : 'bg-muted')}>
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  )
}

function ShareButton({
  onClick, label, colour, icon,
}: {
  onClick: () => void; label: string; colour: string; icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-white text-xs font-semibold transition-colors',
        colour,
      )}
    >
      {icon} {label}
    </button>
  )
}
