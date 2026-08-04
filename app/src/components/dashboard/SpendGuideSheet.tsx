// app/src/components/dashboard/SpendGuideSheet.tsx
// Full-screen spend guide — mirrors ChoreGuideSheet structure.
// Child searches/browses categorised spend items (fuzzy match on kid-language
// synonyms, so "maccies" finds McDonald's), taps one, enters the actual amount
// they paid, then saves to /api/spending. The category is persisted with every
// entry so families can track what children spend on over time.
import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { logSpend, logImpulseOutcome } from '../../lib/api'
import { shouldTriggerImpulseSpeedBump } from '../../lib/impulseSpeedBump'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { useDragToClose } from '../../hooks/useDragToClose'
import { tick } from '../../lib/haptics'
import { ErrorBox } from '../ui/ErrorBox'
import { currencySymbol } from '../../lib/locale'
import { SPEND_CATEGORIES } from '../../lib/spendCategories'

// ── Category icon ────────────────────────────────────────────────────────────
const P = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: '1.8', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

function CategoryIcon({ id, size = 16 }: { id: string; size?: number }) {
  const p = { ...P, width: size, height: size }
  switch (id) {
    case 'food':
      return <svg {...p}><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
    case 'games':
      return <svg {...p}><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>
    case 'entertainment':
      return <svg {...p}><path d="M2 12a10 10 0 1 0 20 0 10 10 0 0 0-20 0"/><path d="M12 8v4l3 3"/></svg>
    case 'clothes':
      return <svg {...p}><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>
    case 'stationery':
      return <svg {...p}><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
    case 'toys':
      return <svg {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    case 'tech':
      return <svg {...p}><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
    case 'books':
      return <svg {...p}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
    case 'gifts':
      return <svg {...p}><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
    default: // 'other' + fallback
      return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
  }
}

// ── Spend items data ─────────────────────────────────────────────────────────
// synonyms = the words a child might actually type (slang, brands, regional
// terms). Fuzzy search matches against label + synonyms so the same canonical
// item is found regardless of the language each child uses.
interface SpendItem {
  id:        string
  category:  string
  label:     string
  synonyms?: string[]
}

const SPEND_ITEMS: SpendItem[] = [
  // Food & Treats
  { id: 'tuck-shop',   category: 'food', label: 'Tuck shop / school canteen', synonyms: ['tuck shop', 'canteen', 'school lunch', 'dinner money', 'school snack'] },
  { id: 'fast-food',   category: 'food', label: "McDonald's / fast food",     synonyms: ['mcdonalds', 'maccies', 'mcds', 'kfc', 'burger king', 'burger', 'fast food', 'drive thru', 'nuggets'] },
  { id: 'bubble-tea',  category: 'food', label: 'Bubble tea / smoothie',      synonyms: ['bubble tea', 'boba', 'smoothie', 'milkshake', 'frappe'] },
  { id: 'ice-cream',   category: 'food', label: 'Ice cream',                  synonyms: ['ice cream', 'ice lolly', '99 flake', 'gelato', 'mr whippy'] },
  { id: 'sweets',      category: 'food', label: 'Sweets & snacks',            synonyms: ['sweets', 'candy', 'chocolate', 'crisps', 'snacks', 'fizzy drink', 'pop', 'soda', 'haribo'] },
  { id: 'coffee-shop', category: 'food', label: 'Coffee shop (Costa, Starbucks)', synonyms: ['costa', 'starbucks', 'coffee', 'hot chocolate', 'cafe', 'caramel'] },
  { id: 'takeaway',    category: 'food', label: 'Takeaway pizza / kebab',     synonyms: ['takeaway', 'pizza', 'kebab', 'chinese', 'dominos', 'just eat', 'deliveroo', 'uber eats', 'nandos'] },
  { id: 'vending',     category: 'food', label: 'Vending machine',            synonyms: ['vending machine', 'vending'] },
  // Games & Apps
  { id: 'robux',        category: 'games', label: 'Roblox Robux',                 synonyms: ['robux', 'roblox'] },
  { id: 'v-bucks',      category: 'games', label: 'Fortnite V-Bucks',             synonyms: ['vbucks', 'v-bucks', 'fortnite', 'fortnite skins', 'skin'] },
  { id: 'minecraft',    category: 'games', label: 'Minecraft / in-game item',     synonyms: ['minecraft', 'minecoins', 'in game item'] },
  { id: 'app-purchase', category: 'games', label: 'App Store / Google Play',      synonyms: ['app store', 'google play', 'in app', 'app purchase', 'game app'] },
  { id: 'steam-game',   category: 'games', label: 'Steam / PC game',              synonyms: ['steam', 'pc game'] },
  { id: 'console-game', category: 'games', label: 'Console game or DLC',          synonyms: ['console game', 'dlc', 'xbox game', 'playstation game', 'ps5 game', 'switch game'] },
  { id: 'music-sub',    category: 'games', label: 'Spotify / music subscription', synonyms: ['spotify', 'apple music', 'music', 'youtube music'] },
  { id: 'gaming-sub',   category: 'games', label: 'Nintendo Online / Game Pass',  synonyms: ['game pass', 'xbox live', 'nintendo online', 'psn', 'ps plus', 'subscription'] },
  // Entertainment
  { id: 'cinema',      category: 'entertainment', label: 'Cinema ticket',                  synonyms: ['cinema', 'movies', 'film', 'odeon', 'vue', 'cineworld', 'popcorn'] },
  { id: 'bowling',     category: 'entertainment', label: 'Bowling',                        synonyms: ['bowling', 'ten pin'] },
  { id: 'arcade',      category: 'entertainment', label: 'Arcade / laser tag',             synonyms: ['arcade', 'laser tag', 'laser quest', 'claw machine'] },
  { id: 'escape-room', category: 'entertainment', label: 'Escape room',                    synonyms: ['escape room'] },
  { id: 'trampoline',  category: 'entertainment', label: 'Trampoline park',                synonyms: ['trampoline', 'trampoline park', 'jump', 'flip out'] },
  { id: 'mini-golf',   category: 'entertainment', label: 'Mini golf',                      synonyms: ['mini golf', 'crazy golf', 'putting'] },
  { id: 'swimming',    category: 'entertainment', label: 'Swimming pool / leisure centre', synonyms: ['swimming', 'pool', 'leisure centre', 'swim'] },
  { id: 'theme-park',  category: 'entertainment', label: 'Theme park / fairground',        synonyms: ['theme park', 'fairground', 'funfair', 'alton towers', 'rides', 'thorpe park'] },
  // Clothes & Style
  { id: 'trainers',      category: 'clothes', label: 'Trainers / shoes',  synonyms: ['trainers', 'shoes', 'sneakers', 'nike', 'adidas'] },
  { id: 'tshirt-hoodie', category: 'clothes', label: 'T-shirt / hoodie',  synonyms: ['tshirt', 't-shirt', 'hoodie', 'jumper', 'top'] },
  { id: 'cap-hat',       category: 'clothes', label: 'Cap / hat',         synonyms: ['cap', 'hat', 'beanie'] },
  { id: 'bag',           category: 'clothes', label: 'Bag / backpack',    synonyms: ['bag', 'backpack', 'rucksack'] },
  { id: 'sunglasses',    category: 'clothes', label: 'Sunglasses',        synonyms: ['sunglasses', 'shades'] },
  { id: 'socks',         category: 'clothes', label: 'Socks / underwear', synonyms: ['socks', 'underwear', 'pants'] },
  // Stationery & School
  { id: 'pens',          category: 'stationery', label: 'Pens / pencils',           synonyms: ['pens', 'pencils', 'biro', 'highlighter'] },
  { id: 'notebook',      category: 'stationery', label: 'Notebook / diary',         synonyms: ['notebook', 'diary', 'journal', 'pad'] },
  { id: 'art-supplies',  category: 'stationery', label: 'Art supplies / paints',    synonyms: ['art supplies', 'paints', 'paint', 'markers', 'sketchbook'] },
  { id: 'ruler-etc',     category: 'stationery', label: 'Ruler, scissors, glue',    synonyms: ['ruler', 'scissors', 'glue', 'rubber', 'eraser'] },
  { id: 'school-trip',   category: 'stationery', label: 'School trip contribution', synonyms: ['school trip', 'trip', 'excursion', 'outing'] },
  { id: 'revision-book', category: 'stationery', label: 'Revision book / workbook', synonyms: ['revision', 'workbook', 'study guide', 'cgp'] },
  // Toys & Hobbies
  { id: 'lego',          category: 'toys', label: 'LEGO set',                     synonyms: ['lego', 'bricks'] },
  { id: 'trading-cards', category: 'toys', label: 'Trading cards (Pokémon, etc.)', synonyms: ['pokemon', 'pokemon cards', 'trading cards', 'match attax', 'football cards'] },
  { id: 'action-figure', category: 'toys', label: 'Action figure / doll',         synonyms: ['action figure', 'doll', 'figure', 'figurine'] },
  { id: 'board-game',    category: 'toys', label: 'Board game / puzzle',          synonyms: ['board game', 'puzzle', 'jigsaw', 'card game'] },
  { id: 'craft-kit',     category: 'toys', label: 'Craft kit / science kit',      synonyms: ['craft kit', 'science kit', 'slime', 'making kit'] },
  { id: 'sports-eq',     category: 'toys', label: 'Sports equipment',             synonyms: ['football', 'sports', 'ball', 'equipment', 'shin pads', 'gloves'] },
  // Tech & Gadgets
  { id: 'phone-case',  category: 'tech', label: 'Phone case / screen protector', synonyms: ['phone case', 'case', 'screen protector'] },
  { id: 'earphones',   category: 'tech', label: 'Earphones / headphones',        synonyms: ['earphones', 'headphones', 'airpods', 'earbuds'] },
  { id: 'phone-topup', category: 'tech', label: 'Phone top-up / credit',         synonyms: ['top up', 'topup', 'phone credit', 'data', 'sim'] },
  { id: 'usb-cable',   category: 'tech', label: 'USB cable / charger',           synonyms: ['cable', 'charger', 'usb', 'charging cable', 'lightning cable'] },
  { id: 'power-bank',  category: 'tech', label: 'Power bank',                    synonyms: ['power bank', 'battery pack', 'portable charger'] },
  // Books & Reading
  { id: 'novel',     category: 'books', label: 'Novel / fiction book',  synonyms: ['book', 'novel', 'fiction', 'story book'] },
  { id: 'comic',     category: 'books', label: 'Comic / graphic novel', synonyms: ['comic', 'graphic novel', 'manga'] },
  { id: 'magazine',  category: 'books', label: 'Magazine',              synonyms: ['magazine', 'mag'] },
  { id: 'audiobook', category: 'books', label: 'Audiobook / e-book',    synonyms: ['audiobook', 'ebook', 'e-book', 'kindle', 'audible'] },
  // Gifts
  { id: 'gift-friend', category: 'gifts', label: 'Birthday gift for a friend', synonyms: ['birthday present', 'gift', 'present', 'birthday gift'] },
  { id: 'gift-wrap',   category: 'gifts', label: 'Gift wrap / card',           synonyms: ['gift wrap', 'wrapping paper', 'card', 'birthday card'] },
  { id: 'xmas-gift',   category: 'gifts', label: 'Christmas / holiday gift',   synonyms: ['christmas present', 'xmas gift', 'holiday gift', 'secret santa'] },
  { id: 'charity',     category: 'gifts', label: 'Charity donation',           synonyms: ['charity', 'donation', 'fundraiser', 'give'] },
]

/** True if the typed query matches a spend item's label or any of its synonyms. */
function matchesSpend(item: SpendItem, query: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  if (item.label.toLowerCase().includes(q)) return true
  return (item.synonyms ?? []).some(s => s.toLowerCase().includes(q))
}

/** Best-guess category for free-typed text — used to pre-select the custom picker. */
function detectCategory(text: string): string {
  const q = text.toLowerCase().trim()
  if (!q) return 'other'
  const hit = SPEND_ITEMS.find(i => matchesSpend(i, q))
  return hit ? hit.category : 'other'
}

// Only the categories that actually have catalogue items get a filter pill.
const FILTERABLE = SPEND_CATEGORIES.filter(c => SPEND_ITEMS.some(i => i.category === c.id))

// ── Component ────────────────────────────────────────────────────────────────
interface Props {
  open:      boolean
  familyId:  string
  childId:   string
  currency:  string
  appView:   'ORCHARD' | 'CLEAN'
  availableBalancePence: number
  onClose:   () => void
  onSaved:   () => void
}

interface EntryState {
  title:     string
  amountStr: string
  note:      string
  noteOpen:  boolean
  custom:    boolean   // true = custom title field is editable
  category:  string
}

export function SpendGuideSheet({ open, familyId, childId, currency, appView, availableBalancePence, onClose, onSaved }: Props) {
  const symbol = currencySymbol(currency)

  const [entry,   setEntry]   = useState<EntryState | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [cooldown, setCooldown] = useState<{ amountPence: number } | null>(null)

  // Search + category filter
  const [search,   setSearch]   = useState('')
  const [category, setCategory] = useState('all')

  const closeEntry = () => { void tick(); setEntry(null); setSaveErr(null); setCooldown(null) }
  const { sheetRef: entrySheetRef, handleProps: entryHandleProps } = useDragToClose(closeEntry)

  useAndroidBack(open && !entry, onClose)
  useAndroidBack(!!entry,        closeEntry)

  useEffect(() => {
    if (!entry) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (cooldown) handleCooldownWait()
      else closeEntry()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, cooldown])

  // Catalogue grouped by category, after search + filter. Only groups with at
  // least one match are kept, so headings never sit above an empty list.
  const groups = useMemo(() => {
    return FILTERABLE
      .filter(cat => category === 'all' || cat.id === category)
      .map(cat => ({
        cat,
        items: SPEND_ITEMS.filter(i => i.category === cat.id && matchesSpend(i, search)),
      }))
      .filter(g => g.items.length > 0)
  }, [search, category])

  const noResults = groups.length === 0

  function openItem(item: SpendItem) {
    setEntry({ title: item.label, amountStr: '', note: '', noteOpen: false, custom: false, category: item.category })
    setSaveErr(null)
  }

  function openCustom() {
    // Pre-fill the title with whatever was searched, and pre-select a category.
    const title = search.trim()
    setEntry({ title, amountStr: '', note: '', noteOpen: false, custom: true, category: detectCategory(title) })
    setSaveErr(null)
  }

  function handleSaveClick() {
    if (!entry) return
    const title = entry.title.trim()
    if (!title) { setSaveErr('Please add a description.'); return }
    const pence = Math.round(parseFloat(entry.amountStr || '0') * 100)
    if (!pence || pence <= 0) { setSaveErr('Please enter an amount.'); return }

    if (shouldTriggerImpulseSpeedBump(pence, availableBalancePence)) {
      setCooldown({ amountPence: pence })
      return
    }
    void doSave(pence, title)
  }

  async function doSave(pence: number, title: string) {
    if (!entry) return
    setSaving(true)
    setSaveErr(null)
    try {
      await logSpend({
        family_id: familyId,
        title,
        amount:    pence,
        currency,
        category:  entry.category,
        note:      entry.note.trim() || undefined,
      })
      setEntry(null)
      setSuccess(true)
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  function handleCooldownWait() {
    if (!cooldown) return
    logImpulseOutcome({
      family_id: familyId, child_id: childId,
      amount_pence: cooldown.amountPence, balance_pence: availableBalancePence,
      outcome: 'waited',
    }).catch((err) => console.warn('[ImpulseSpeedBump] failed to log outcome', err))
    setCooldown(null)
    closeEntry()
  }

  function handleCooldownProceed() {
    if (!cooldown || !entry) return
    const amountPence = cooldown.amountPence
    const title = entry.title.trim()
    logImpulseOutcome({
      family_id: familyId, child_id: childId,
      amount_pence: amountPence, balance_pence: availableBalancePence,
      outcome: 'proceeded',
    }).catch((err) => console.warn('[ImpulseSpeedBump] failed to log outcome', err))
    setCooldown(null)
    void doSave(amountPence, title)
  }

  if (!open) return null

  if (success) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--color-bg)] px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--brand-primary)]/15 flex items-center justify-center mb-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2 className="text-xl font-bold text-[var(--color-text)] mb-2">Spend logged!</h2>
        <p className="text-[14px] text-[var(--color-text-muted)] mb-8">Your balance has been updated.</p>
        <button
          onClick={() => { setSuccess(false); onSaved() }}
          className="rounded-xl bg-[var(--brand-primary)] text-white px-8 py-3 text-[14px] font-bold"
        >
          Done
        </button>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-bg)] overflow-hidden overscroll-none">

      {/* ── Sticky top: header + search + category pills ── */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-4 pt-6 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-[17px] font-bold text-[var(--color-text)]">Spend Guide</h2>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">What did you buy?</p>
          </div>
          <button
            onClick={onClose}
            className="tap-target-44 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="mb-3">
          <input
            type="search"
            placeholder="Search what you bought…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white dark:bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition shadow-sm"
          />
        </div>

        {/* Category pills */}
        <div
          className="flex gap-2 pb-3 overflow-x-auto"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
        >
          <button
            onClick={() => setCategory('all')}
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
              category === 'all'
                ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]'
            }`}
          >
            All
          </button>
          {FILTERABLE.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                category === cat.id
                  ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]'
              }`}
            >
              <CategoryIcon id={cat.id} size={13} />
              {cat.heading}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable item list ── */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-8" style={{ touchAction: 'pan-y' }}>

        {noResults && (
          <div className="py-12 flex flex-col items-center gap-3 px-6 text-center">
            <p className="text-[14px] text-[var(--color-text-muted)]">
              {search ? `Nothing found for "${search}"` : 'No items in this category'}
            </p>
            <button
              onClick={openCustom}
              className="px-4 py-2 rounded-xl border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[13px] font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition cursor-pointer"
            >
              {search ? `Log "${search}" instead` : 'Add a custom spend'}
            </button>
          </div>
        )}

        {groups.map(({ cat, items }) => (
          <div key={cat.id} className="mt-7 first:mt-5">
            <h3 className="flex items-center gap-2.5 mb-2.5">
              <span className="w-7 h-7 rounded-lg bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)] flex items-center justify-center shrink-0">
                <CategoryIcon id={cat.id} size={15} />
              </span>
              <span className="text-[15px] font-extrabold text-[var(--color-text)] tracking-tight">
                {cat.heading}
              </span>
            </h3>
            {items.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between py-3 border-b border-[var(--color-border)] last:border-0"
              >
                <p className="text-[14px] text-[var(--color-text)] flex-1 mr-3">{item.label}</p>
                <button
                  onClick={() => openItem(item)}
                  className="rounded-lg bg-[var(--brand-primary)] text-white px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90 cursor-pointer shrink-0"
                >
                  Log
                </button>
              </div>
            ))}
          </div>
        ))}

        {/* ── Custom entry ── */}
        {!noResults && (
          <div className="mt-8 border-t border-[var(--color-border)] pt-6 text-center">
            <p className="text-[13px] text-[var(--color-text-muted)] mb-3">
              Don't see what you spent money on?
            </p>
            <button
              onClick={openCustom}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[13px] font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Add a custom spend
            </button>
          </div>
        )}
      </div>

      {/* ── Amount entry sub-sheet ── */}
      {entry && cooldown && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={handleCooldownWait} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Just checking"
            tabIndex={-1}
            className="relative bg-[var(--color-surface)] rounded-t-2xl px-5 pt-2 pb-8 space-y-4 max-h-[88%] overflow-y-auto"
          >
            <div className="flex justify-center pt-3 pb-0">
              <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            </div>
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
              Just checking
            </p>
            <p className="text-[15px] leading-relaxed text-[var(--color-text)]">
              {appView === 'CLEAN'
                ? 'This is 15% of your available balance. Delaying big spends by 48 hours usually feels better later. Shall we pause?'
                : "We've noticed this harvest is very large! If you keep these seeds instead, your grove keeps growing. Are you sure?"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleCooldownWait}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-3 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
              >
                Wait a bit
              </button>
              <button
                onClick={handleCooldownProceed}
                disabled={saving}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-3 text-[14px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-all"
              >
                {saving ? 'Saving…' : "I'm sure, log it"}
              </button>
            </div>
          </div>
        </div>
      )}

      {entry && !cooldown && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={closeEntry} />
          <div
            ref={entrySheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Log a spend"
            tabIndex={-1}
            className="relative bg-[var(--color-surface)] rounded-t-2xl px-5 pt-2 pb-8 space-y-4 max-h-[88%] overflow-y-auto"
          >

            {/* Drag handle */}
            <div {...entryHandleProps}>
              <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            </div>

            <div>
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">
                Log a spend
              </p>
              {entry.custom ? (
                <input
                  type="text"
                  value={entry.title}
                  onChange={e => setEntry(v => v && ({ ...v, title: e.target.value, category: detectCategory(e.target.value) }))}
                  placeholder="What did you buy?"
                  autoFocus
                  className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[15px] font-semibold bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] mt-1"
                />
              ) : (
                <p className="text-[17px] font-bold text-[var(--color-text)]">{entry.title}</p>
              )}
            </div>

            {/* Category — read-only chip for catalogue items, picker for custom */}
            <div>
              <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-1.5">
                Category
              </label>
              {entry.custom ? (
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {SPEND_CATEGORIES.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setEntry(v => v && ({ ...v, category: c.id }))}
                      className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                        entry.category === c.id
                          ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                          : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)]'
                      }`}
                    >
                      <CategoryIcon id={c.id} size={13} />
                      {c.heading}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
                  <CategoryIcon id={entry.category} size={13} />
                  {SPEND_CATEGORIES.find(c => c.id === entry.category)?.heading ?? 'Other'}
                </span>
              )}
            </div>

            <ErrorBox message={saveErr} />

            {/* Amount */}
            <div>
              <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-1.5">
                How much did you spend?
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-[var(--color-text-muted)]">
                  {symbol}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  autoFocus={!entry.custom}
                  value={entry.amountStr}
                  onChange={e => setEntry(v => v && ({ ...v, amountStr: e.target.value }))}
                  placeholder="0.00"
                  className="w-full border border-[var(--color-border)] rounded-xl pl-8 pr-3 py-3 text-[20px] font-bold tabular-nums bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </div>
            </div>

            {/* Optional note */}
            <div>
              <button
                type="button"
                onClick={() => setEntry(v => v && ({ ...v, noteOpen: !v.noteOpen }))}
                className="text-[13px] font-semibold text-[var(--brand-primary)] cursor-pointer"
              >
                {entry.noteOpen ? '▾ Remove note' : '▸ Add a note'}
              </button>
              {entry.noteOpen && (
                <textarea
                  value={entry.note}
                  onChange={e => setEntry(v => v && ({ ...v, note: e.target.value }))}
                  placeholder="e.g. birthday money treat"
                  rows={2}
                  className="mt-2 w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[13px] resize-none bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={closeEntry}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-3 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={handleSaveClick}
                disabled={saving}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-3 text-[14px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-all"
              >
                {saving ? 'Saving…' : 'Save spend →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
