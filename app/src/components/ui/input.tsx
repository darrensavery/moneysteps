import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const inputVariants = cva(
  'flex h-11 w-full rounded-xl border bg-background px-3.5 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      error: {
        true:  'border-red-400 focus-visible:ring-red-400',
        false: 'border-input focus-visible:ring-ring',
      },
    },
    defaultVariants: { error: false },
  },
)

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => (
    <input
      type={type}
      aria-invalid={error ? true : undefined}
      className={cn(inputVariants({ error }), className)}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input, inputVariants }
