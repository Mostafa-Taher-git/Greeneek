/**
 * Validate the CI failure ledger workbook.
 *
 * Every failed/cancelled Actions run in `All Failures` must carry a group id,
 * root cause, fix commit, regression guard, verification run URL, and a status
 * of FIXED-VERIFIED. The script reads the .xlsx directly (no spreadsheet
 * service) so it can run in CI and locally.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

const path = resolve(process.argv[2] ?? process.env.CI_LEDGER ?? 'greeneek-ci-failures.xlsx')
const zip = unzipSync(new Uint8Array(readFileSync(path)))
const xml = (name) => (zip[name] === undefined ? '' : strFromU8(zip[name]))
const decode = (value) => value
  .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&apos;', "'")

const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(match => decode([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')))

const required = [
  'Group ID', 'Root Cause', 'Fix Commit SHA', 'Guard (file/test)',
  'Verification Run URL', 'Status',
]

const sheets = Object.keys(zip).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
let header = null
let rows = []
for (const name of sheets) {
  const parsed = [...xml(name).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(match => {
    const cells = [...match[1].matchAll(/<c[^>]*?(?:t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)]
    return cells.map(cell => {
      const raw = (cell[2].match(/<v>([\s\S]*?)<\/v>/) ?? cell[2].match(/<t[^>]*>([\s\S]*?)<\/t>/))?.[1] ?? ''
      return cell[1] === 's' ? (shared[Number(raw)] ?? '') : decode(raw)
    })
  })
  const candidate = parsed[0] ?? []
  if (candidate.includes('Failure group') && candidate.includes('Run URL')) {
    header = candidate
    rows = parsed.slice(1).filter(row => row.some(cell => cell.trim() !== ''))
    break
  }
}
if (header === null) throw new Error('verify-ci-ledger: no All Failures sheet found')

const errors = []
for (const column of required) {
  if (!header.includes(column)) errors.push(`missing column: ${column}`)
}
// The inventory's own "Status" column records the historical run result;
// the ledger's "Status" column is the rightmost one and owns FIXED-VERIFIED.
const index = Object.fromEntries(required.map(column => [column, header.lastIndexOf(column)]))
if (errors.length === 0) {
  for (const [rowNumber, row] of rows.entries()) {
    const id = row[0] ?? `#${rowNumber + 2}`
    for (const column of required) {
      const value = row[index[column]]?.trim() ?? ''
      if (value === '') errors.push(`row ${id}: empty ${column}`)
      else if (column === 'Status' && value !== 'FIXED-VERIFIED') errors.push(`row ${id}: status ${value}`)
      else if (column === 'Verification Run URL' && !value.startsWith('https://github.com/')) errors.push(`row ${id}: invalid verification URL`)
    }
  }
}
if (errors.length > 0) {
  console.error(`verify-ci-ledger: ${String(errors.length)} problem(s)`)
  console.error(errors.slice(0, 20).join('\n'))
  process.exit(1)
}
console.log(`verify-ci-ledger: ${String(rows.length)} failure rows, all required columns complete and FIXED-VERIFIED`)
