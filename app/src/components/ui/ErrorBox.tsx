interface Props {
  message: string | null | undefined
  className?: string
  id?: string
}

export function ErrorBox({ message, className = '', id }: Props) {
  if (!message) return null
  return (
    <div id={id} role="alert" className={`rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-2.5 flex items-start gap-2 ${className}`}>
      <svg className="shrink-0 mt-0.5 text-red-500 dark:text-red-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p className="text-[0.75rem] text-red-700 dark:text-red-300 leading-snug">{message}</p>
    </div>
  )
}
