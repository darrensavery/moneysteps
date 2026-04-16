import { useRef, useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FullLogo } from '../components/ui/Logo'
import { setPendingMilestone } from '../components/celebration'
import { childLogin } from '../lib/api'

const PIN_LENGTH = 4

export function PinScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const role = params.get('role') ?? 'parent'

  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  function handleInput(idx: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1)
    if (!char) return
    const next = [...digits]
    next[idx] = char
    setDigits(next)
    setError('')
    if (idx < PIN_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus()
    } else {
      // Last digit — auto submit
      submitPin(next.join(''))
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        const next = [...digits]
        next[idx] = ''
        setDigits(next)
      } else if (idx > 0) {
        inputRefs.current[idx - 1]?.focus()
        const next = [...digits]
        next[idx - 1] = ''
        setDigits(next)
      }
    }
  }

  async function submitPin(pin: string) {
    if (pin.length < PIN_LENGTH) return
    setSubmitting(true)
    try {
      const storedPin = localStorage.getItem(`mc_pin_${role}`)
      if (storedPin && storedPin !== pin) {
        setError('Incorrect PIN. Try again.')
        setDigits(Array(PIN_LENGTH).fill(''))
        inputRefs.current[0]?.focus()
        setSubmitting(false)
        return
      }
      // No pin stored yet — first time, accept any 4-digit pin
      if (!storedPin) {
        localStorage.setItem(`mc_pin_${role}`, pin)
      }
      if (role === 'child') {
        const familyId = localStorage.getItem('mc_family_id') ?? ''
        const userId   = localStorage.getItem('mc_user_id') ?? ''
        if (familyId && userId) {
          try {
            const result = await childLogin(familyId, userId, pin)
            if (result.graduation_pending) {
              setPendingMilestone('GRADUATION')
            }
          } catch {
            // childLogin failure is non-blocking — proceed to dashboard
          }
        }
      }
      navigate(role === 'child' ? '/child' : '/parent')
    } catch {
      setError('Something went wrong. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh bg-[#F5F4F0] flex flex-col">
      <header className="sticky top-0 bg-white border-b border-[#D3D1C7] shadow-[0_1px_4px_rgba(0,0,0,.05)] px-4 py-3 flex items-center gap-2.5">
        <FullLogo iconSize={26} />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
        <div className="text-center mb-8">
          <h2 className="text-[22px] font-extrabold text-[#1C1C1A] tracking-tight mb-1.5">Enter your PIN</h2>
          <p className="text-[14px] text-[#6b6a66]">
            {role === 'child' ? 'Your personal 4-digit code' : 'Parent access PIN'}
          </p>
        </div>

        <div className="flex gap-3 mb-5">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={e => handleInput(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              disabled={submitting}
              className={`
                w-[54px] h-[66px] text-center text-[28px] font-extrabold
                border-2 rounded-xl outline-none
                transition-colors duration-100
                ${error ? 'border-red-400 bg-red-50 text-red-700' : d ? 'border-teal-500 bg-white' : 'border-[#D3D1C7] bg-white'}
                focus:border-teal-500
              `}
            />
          ))}
        </div>

        {error && (
          <p className="text-[14px] font-semibold text-red-600 mb-4">{error}</p>
        )}

        <button
          onClick={() => navigate(-1)}
          className="text-[14px] text-[#6b6a66] underline underline-offset-2 cursor-pointer mt-2"
        >
          Back
        </button>
      </main>
    </div>
  )
}
