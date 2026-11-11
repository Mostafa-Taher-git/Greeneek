/**
 * Measurement helpers shared by the documentation generators.
 * @module scripts/lib/catalog-stats
 */

/**
 * The word count of the largest section in one document.
 *
 * A section starts at a level-two heading and runs until the next one; the
 * words before the first heading count as their own section.
 * @param content - the rendered document text.
 * @returns the largest section's word count.
 */
export function largestSectionWords(content: string): number {
  let largest = 0
  let current = 0
  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      largest = Math.max(largest, current)
      current = 0
    } else {
      current += line.split(/\s+/).filter(Boolean).length
    }
  }
  return Math.max(largest, current)
}
