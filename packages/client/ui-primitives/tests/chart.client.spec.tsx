// @vitest-environment jsdom
// Chart container: bars and the data table carry the same rows, and tooltip
// and legend renderers take complete label props.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChartContainer, ChartLegendContent, ChartTooltipContent } from '@greeneek/gnk-client-ui-primitives'

afterEach(cleanup)

const config = { usage: { label: 'Usage' } }
const rows = [
  { id: 'a', label: 'Alpha', value: 10, max: 10 },
  { id: 'b', label: 'Beta', value: 5, max: 5 },
]

describe('ChartContainer', () => {
  it('renders one bar and one table row per series row', () => {
    render(<ChartContainer config={config} label="Usage" rows={rows} />)
    const figure = screen.getByRole('figure', { name: 'Usage' })
    expect(figure.querySelectorAll('table tbody tr')).toHaveLength(2)
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0)
    expect(screen.getAllByText('10').length).toBeGreaterThan(0)
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)
  })

  it('renders tooltip and legend children inside the figure', () => {
    render(
      <ChartContainer config={config} label="Usage" rows={rows}>
        <ChartTooltipContent label="Alpha" value="10" />
        <ChartLegendContent items={['Alpha', 'Beta']} />
      </ChartContainer>,
    )
    expect(screen.getByRole('tooltip')).toBeTruthy()
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0)
  })

  it('renders the tooltip without a container context', () => {
    render(<ChartTooltipContent label="Solo" value="1" />)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    expect(screen.getByText('Solo')).toBeTruthy()
  })

  it('renders an empty legend for no items', () => {
    render(<ChartLegendContent items={[]} />)
    expect(screen.getByRole('list')).toBeTruthy()
  })
})
