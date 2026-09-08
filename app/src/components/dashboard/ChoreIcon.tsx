import { renderCategoryIcon, guessChoreCategory } from '../../lib/choreIcons'

/**
 * ChoreIcon — renders a chore's stored category icon when available
 * (`iconKey`, set at creation time), falling back to a keyword guess from
 * the title for chores created before icons were persisted.
 */
export function ChoreIcon({ title, iconKey, size = 20 }: { title: string; iconKey?: string | null; size?: number }) {
  return renderCategoryIcon(iconKey || guessChoreCategory(title), size)
}
