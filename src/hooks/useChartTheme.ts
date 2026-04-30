// useChartTheme — resolves the design tokens that recharts needs into
// concrete color strings.
//
// Why a hook: recharts components accept color props as strings (e.g. the
// `stroke` on <CartesianGrid>) and pass them straight to SVG attributes.
// SVG doesn't resolve CSS custom properties in attribute values, so we have
// to read the computed styles off <html> ourselves and pass concrete colors.
//
// The hook re-reads when the data-theme attribute on <html> changes, so
// charts re-render when the user toggles light/dark.
import { useEffect, useState } from 'react'

export interface ChartTheme {
  /** Axis lines + gridlines — the quiet structural lines. */
  grid: string
  /** Axis tick labels. */
  tick: string
  /** Tooltip background. */
  tooltipBg: string
  /** Tooltip border. */
  tooltipBorder: string
  /** Tooltip text. */
  tooltipText: string
  /** Primary series color (accent) for highlighted data. */
  accent: string
  /** Muted series color for secondary / reference series. */
  muted: string
  /** Semantic palette — use sparingly. */
  success: string
  warning: string
  danger: string
}

function resolve(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const root = document.documentElement
  const v = getComputedStyle(root).getPropertyValue(varName).trim()
  return v || fallback
}

function read(): ChartTheme {
  return {
    grid: resolve('--color-border', '#e4e4e7'),
    tick: resolve('--color-fg-muted', '#52525b'),
    tooltipBg: resolve('--color-bg-elevated', '#ffffff'),
    tooltipBorder: resolve('--color-border-strong', '#d4d4d8'),
    tooltipText: resolve('--color-fg', '#09090b'),
    accent: resolve('--color-accent', '#4f46e5'),
    muted: resolve('--color-fg-subtle', '#71717a'),
    success: resolve('--color-success', '#16a34a'),
    warning: resolve('--color-warning', '#d97706'),
    danger: resolve('--color-danger', '#dc2626'),
  }
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(() => read())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return theme
}

// Categorical palette for bar charts where each bar is a different bucket
// (states, regions, branches when not coloring by client). Token-derived
// where possible, with extra hues blended in for variety. Sticking to a
// muted, desaturated palette so the chart reads as data-tool, not marketing.
export const CHART_CATEGORICAL = [
  '#4f46e5', // indigo (accent)
  '#0891b2', // cyan-600
  '#16a34a', // green-600
  '#d97706', // amber-600
  '#7c3aed', // violet-600
  '#dc2626', // red-600
  '#0284c7', // sky-600
  '#9333ea', // purple-600
] as const

// Standard recharts <Tooltip> styling using theme tokens. Pass via
// `contentStyle={tooltipStyle(theme)}` on every chart.
export function tooltipStyle(theme: ChartTheme): React.CSSProperties {
  return {
    backgroundColor: theme.tooltipBg,
    border: `1px solid ${theme.tooltipBorder}`,
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 12,
    color: theme.tooltipText,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  }
}

// Standard tick style — small, muted text.
export function tickStyle(theme: ChartTheme) {
  return { fontSize: 11, fill: theme.tick }
}
