/** Presentation helpers. Numbers in this game span single acres to billions. */

export function money(dollars: number): string {
  const abs = Math.abs(dollars)
  const sign = dollars < 0 ? '−' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${Math.round(abs)}`
}

export function mw(value: number): string {
  return `${Math.round(value).toLocaleString()} MW`
}

export function acres(value: number): string {
  return `${Math.round(value).toLocaleString()} acres`
}

export function quarters(n: number): string {
  return `${n} ${n === 1 ? 'quarter' : 'quarters'}`
}
