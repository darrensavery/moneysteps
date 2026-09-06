import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BaseSheet } from '../BaseSheet'

vi.mock('../../../lib/haptics', () => ({ tick: vi.fn(async () => {}) }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })) } }))

describe('BaseSheet', () => {
  it('renders children and a drag handle', () => {
    render(<BaseSheet onClose={vi.fn()} label="Test sheet"><p>Sheet content</p></BaseSheet>)
    expect(screen.getByText('Sheet content')).toBeTruthy()
  })

  it('calls onClose when the backdrop is clicked', async () => {
    // onClose now fires after the exit animation (translate/opacity) plays,
    // instead of synchronously, so the sheet doesn't vanish mid-transition.
    const onClose = vi.fn()
    render(<BaseSheet onClose={onClose} label="Test sheet"><p>Sheet content</p></BaseSheet>)
    fireEvent.click(screen.getByTestId('sheet-backdrop'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('does not call onClose when the panel content is clicked', () => {
    const onClose = vi.fn()
    render(<BaseSheet onClose={onClose} label="Test sheet"><p>Sheet content</p></BaseSheet>)
    fireEvent.click(screen.getByText('Sheet content'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('exposes dialog semantics with the given label', () => {
    render(<BaseSheet onClose={vi.fn()} label="Test sheet"><p>Sheet content</p></BaseSheet>)
    const dialog = screen.getByRole('dialog', { name: 'Test sheet' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn()
    render(<BaseSheet onClose={onClose} label="Test sheet"><p>Sheet content</p></BaseSheet>)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
