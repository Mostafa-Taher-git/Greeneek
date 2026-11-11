/**
 * Chart container following the shadcn/ui Chart contract, ported onto the
 * client token and CSS-module layer: a `chartConfig` maps series ids to
 * `--chart-*` custom properties, and the tooltip/legend content renderers
 * take complete label props. Series render as CSS bars (no chart library,
 * no Tailwind) and every chart ships its own data table, so color is never
 * the only status signal.
 */
import { createContext, useContext, useId, type ReactNode } from 'react'
import clsx from 'clsx'
import css from './Chart.module.css'

/** Series theme bindings, resolved to `--chart-*` custom properties. */
export interface ChartConfig {
  readonly [seriesId: string]: {
    readonly label?: string
    readonly theme?: { readonly light?: string; readonly dark?: string }
  }
}

/** One numbered series row the container draws and tabulates. */
export interface ChartRow {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly max: number
}

/** Container context: series config plus the chart id for ARIA wiring. */
interface ChartContextValue {
  readonly config: ChartConfig
  readonly chartId: string
}

const ChartContext = createContext<ChartContextValue | null>(null)

/**
 * Responsive chart container: draws one bar per row and the same rows as a
 * table, so the visual and the accessible alternative never drift apart.
 * @param props.config - series ids to theme bindings.
 * @param props.label - accessible name for the figure.
 * @param props.rows - series rows with absolute values and the bar scale.
 * @param props.children - optional tooltip or legend content renderers.
 * @param props.className - container class for layout placement.
 * @returns the chart figure with bars and its table alternative.
 */
export function ChartContainer({ config, label, rows, children, className }: {
  config: ChartConfig
  label: string
  rows: readonly ChartRow[]
  children?: ReactNode
  className?: string | undefined
}) {
  const chartId = useId()
  const scale = Math.max(1, ...rows.map(row => row.max))
  return (
    <ChartContext.Provider value={{ config, chartId }}>
      <figure className={clsx(css.container, className)} aria-label={label} aria-describedby={`${chartId}-table`}>
        {children}
        <div className={css.bars} aria-hidden="true">
          {rows.map(row => (
            <span key={row.id} className={css.barTrack}>
              <span
                className={css.barFill}
                style={{ inlineSize: `${Math.max(4, Math.round((row.value / scale) * 100))}%` }}
              />
            </span>
          ))}
        </div>
        <div className={css.list} role="list">
          {rows.map(row => (
            <div className={css.row} key={row.id} role="listitem">
              <span className={css.rowLabel} dir="auto">{row.label}</span>
              <span className={css.rowValue}>{new Intl.NumberFormat('en-US').format(row.value)}</span>
            </div>
          ))}
        </div>
        <table className={css.table} id={`${chartId}-table`}>
          <caption className={css.caption}>{label}</caption>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                <td>{new Intl.NumberFormat('en-US').format(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </ChartContext.Provider>
  )
}

/**
 * Tooltip content renderer with a complete label prop (primitives own no copy).
 * @param props.label - the hovered series label.
 * @param props.value - the hovered series value, preformatted.
 * @returns the tooltip contents.
 */
export function ChartTooltipContent({ label, value }: { label: string; value: string }) {
  const config = useContext(ChartContext)
  return (
    <div className={css.tooltip} role="tooltip">
      <span className={css.tooltipLabel}>{label}</span>
      <span className={css.tooltipValue}>{value}</span>
      {config === null ? null : <span className={css.tooltipId}>{config.chartId}</span>}
    </div>
  )
}

/**
 * Legend content renderer with complete item props (primitives own no copy).
 * @param props.items - legend entries as label texts.
 * @returns the legend contents.
 */
export function ChartLegendContent({ items }: { items: readonly string[] }) {
  return (
    <div className={css.legend} role="list">
      {items.map(item => (
        <span className={css.legendItem} key={item} role="listitem">{item}</span>
      ))}
    </div>
  )
}
