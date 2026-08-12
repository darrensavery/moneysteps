import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { LearningLabUpsellCard } from '../LearningLabUpsellCard'

describe('LearningLabUpsellCard', () => {
  it('renders the child name in the heading and the price in the CTA', () => {
    render(<LearningLabUpsellCard childName="Ellie" onUpgrade={() => {}} />)

    expect(screen.getByText('Unlock Learning Lab for Ellie')).toBeTruthy()
    expect(screen.getByText(/£29\.99/)).toBeTruthy()
  })

  it('calls onUpgrade when the CTA is clicked', () => {
    const onUpgrade = vi.fn()
    render(<LearningLabUpsellCard childName="Jake" onUpgrade={onUpgrade} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })
})
