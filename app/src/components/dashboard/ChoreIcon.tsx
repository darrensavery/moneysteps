import { renderCategoryIcon, categoryEmoji, guessChoreCategory } from '../../lib/choreIcons'

/**
 * ChoreIcon — renders a chore's stored category icon when available
 * (`iconKey`, set at creation time), falling back to a keyword guess from
 * the title for chores created before icons were persisted.
 *
 * `appView` is the viewing child's own display mode — pass it only from a
 * child-facing screen (their own dashboard/Earn tab). Parent-facing screens
 * (e.g. JobsTab) omit it, which keeps the flat icon regardless of which
 * child is selected — a chore can be assigned to kids on different modes,
 * so the parent's own view shouldn't flip style as they switch children.
 */
export function ChoreIcon({
  title, iconKey, size = 20, appView,
}: {
  title:    string
  iconKey?: string | null
  size?:    number
  appView?: 'ORCHARD' | 'CLEAN'
}) {
  const category = iconKey || guessChoreCategory(title)
  if (appView === 'ORCHARD') {
    return <span style={{ fontSize: size, lineHeight: 1 }}>{categoryEmoji(category)}</span>
  }
  return renderCategoryIcon(category, size)
}
