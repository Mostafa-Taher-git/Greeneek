/**
 * Display formatting shared by the browsing rows and the Thread Details card.
 */

/**
 * Group a count in thousands with the ASCII separator.
 * @param value - the count.
 * @returns the grouped count.
 */
export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Last path segment of a Host directory path, for either separator style.
 * @param path - absolute or relative directory path.
 * @returns the final segment, or the whole path when it has no separator.
 */
export function pathBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}
