import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:   'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline:   'text-foreground',
        success:   'border-transparent bg-green-100 text-green-800',
        warning:   'border-transparent bg-amber-100 text-amber-800',
        // Von Restorff isolation — reserve for exactly one element per view;
        // using it on several badges at once cancels the "stands out" effect.
        highlight: 'border-transparent bg-[var(--brand-primary)] text-white shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-primary)_20%,transparent)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
