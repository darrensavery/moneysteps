/**
 * WelcomeNudge — Static AI Coach introduction at the end of registration.
 *
 * Appears after all stages are complete. No live API call — the persona
 * and message are statically rendered to match the locale/currency.
 *
 * EN (GBP): Collaborative mentor tone
 * PL (PLN): Direct, formal "Neutralny Arbiter" tone
 *
 * Explains:
 *   - What the 14-day evaluation period means
 *   - That the clock doesn't start until the first ledger entry
 *   - What happens at the end of the evaluation
 */

import { Bot, Clock, ChevronRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn }     from '@/lib/utils'
import type { RegistrationState } from './RegistrationShell'

interface Props {
  data: RegistrationState
  onFinish: () => void
}

export function WelcomeNudge({ data, onFinish }: Props) {
  const isPL = data.base_currency === 'PLN'

  const persona = isPL
    ? {
        name:   'Neutralny Arbiter',
        title:  'System Monitorowania Rodzinnego',
        badge:  'AI • Wersja testowa',
        colour: 'from-slate-700 to-slate-900',
      }
    : {
        name:   'Morechard Coach',
        title:  'Your Family Financial Mentor',
        badge:  'AI • Evaluation Mode',
        colour: 'from-primary to-green-700',
      }

  const message = isPL
    ? [
        `Konto rodzinne zostało założone, ${data.display_name?.split(' ')[0] ?? 'Rodzicu'}.`,
        'Okres ewaluacyjny trwa 14 dni. Liczy się od momentu pierwszego wpisu w księdze — nie od daty rejestracji. To gwarancja, że oceniamy aktywne użytkowanie, a nie sam fakt założenia konta.',
        'Kiedy pierwsze zadanie domowe, dodatek lub zakup zostanie zarejestrowany, zegar ruszy. System powiadomi Cię o postępach przez cały okres próbny.',
        'Wszystkie dane są zapisywane w niezmienialnym rejestrze Cloudflare. Twoja rodzinna dokumentacja finansowa zaczyna się teraz.',
      ]
    : [
        `Welcome to Morechard, ${data.display_name?.split(' ')[0] ?? 'there'}.`,
        "Your family record is now established. Here's how the 14-day Coaching Evaluation works: the countdown doesn't begin today. It starts the moment your first real entry is added to the ledger — a chore, an allowance, or a purchase. This ensures we're evaluating active usage, not just account creation.",
        "During the evaluation, I'll be monitoring your family's financial patterns and preparing personalised coaching insights for each child. You'll see a progress bar on your dashboard.",
        "At the end of Day 14 post-activation, you can choose to continue with a lifetime licence or an annual AI subscription. There's no read-only mode — your data is always yours to export.",
      ]

  return (
    <div className="space-y-6">
      {/* Success indicator */}
      <div className="flex flex-col items-center text-center gap-3 pb-2">
        <div className="rounded-full bg-primary/10 p-4">
          <Sparkles size={28} className="text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Setup Complete</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Your family record is secure and ready.
          </p>
        </div>
      </div>

      {/* AI Coach message card */}
      <div className="rounded-2xl overflow-hidden border shadow-sm">
        {/* Coach header */}
        <div className={cn('flex items-center gap-3 px-5 py-3.5 text-white', `bg-gradient-to-r ${persona.colour}`)}>
          <div className="rounded-full bg-white/20 p-2">
            <Bot size={18} />
          </div>
          <div>
            <p className="font-semibold text-sm">{persona.name}</p>
            <p className="text-xs opacity-80">{persona.title}</p>
          </div>
          <span className="ml-auto text-[0.625rem] font-semibold bg-white/20 rounded-full px-2.5 py-1">
            {persona.badge}
          </span>
        </div>

        {/* Message bubbles */}
        <div className="bg-card p-5 space-y-3">
          {message.map((para, i) => (
            <div key={i} className="flex items-start gap-3">
              {i === 0 && (
                <div className="rounded-full bg-primary/10 p-1.5 mt-0.5 shrink-0">
                  <Bot size={12} className="text-primary" />
                </div>
              )}
              <p
                className={cn(
                  'text-sm leading-relaxed rounded-2xl px-4 py-2.5',
                  i === 0
                    ? 'bg-muted font-semibold'
                    : 'bg-muted/60 text-muted-foreground ml-8',
                )}
              >
                {para}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Trial info strip */}
      <div className="flex items-center gap-3 rounded-xl border bg-amber-50 border-amber-200 px-4 py-3">
        <Clock size={16} className="text-amber-600 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {isPL ? 'Ewaluacja nie rozpoczęła się' : 'Evaluation not yet started'}
          </p>
          <p className="text-xs text-amber-700">
            {isPL
              ? 'Zegar ruszy po pierwszym wpisie w księdze — chore, kieszonkowe lub zakup.'
              : 'The 14-day clock starts on your first ledger entry — a chore, allowance, or purchase.'}
          </p>
        </div>
      </div>

      <Button className="w-full h-12 text-base gap-2" onClick={onFinish}>
        {isPL ? 'Otwórz panel rodzinny' : 'Open Family Dashboard'}
        <ChevronRight size={16} />
      </Button>
    </div>
  )
}
