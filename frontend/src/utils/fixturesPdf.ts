import type { Match } from '../services/api'
import { courtLabel, formatTime } from './format'
import { A4, PDF_MARGIN, newA4Doc, pdfSafeFilename, savePdf, wrapText } from './a4Pdf'

const INK = '#14201c'
const MUTED = '#5a6b64'
const ACCENT = '#0b3d2e'
const LINE = '#d5ddd8'

export type FixtureGroupBlock = {
  letter: string
  title: string
  matches: Match[]
}

function sideName(m: Match, side: 'a' | 'b') {
  if (side === 'a') return m.team_a_name || m.team_a_placeholder || 'TBD'
  return m.team_b_name || m.team_b_placeholder || 'TBD'
}

function matchLine(m: Match) {
  return `${sideName(m, 'a')}  vs  ${sideName(m, 'b')}`
}

function groupKey(m: Match) {
  if (m.stage === 'GROUP' && m.round?.startsWith('GROUP_')) {
    return m.round.replace('GROUP_', '')
  }
  return m.round || '?'
}

function matchSort(a: Match, b: Match) {
  const ta = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
  const tb = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
  if (ta !== tb) return ta - tb
  return (a.sort_order || 0) - (b.sort_order || 0)
}

export function buildGroupFixtureBlocks(matches: Match[]): FixtureGroupBlock[] {
  const groups = new Map<string, Match[]>()
  for (const m of matches) {
    if (m.stage !== 'GROUP') continue
    const key = groupKey(m)
    const list = groups.get(key) || []
    list.push(m)
    groups.set(key, list)
  }
  return Array.from(groups.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((letter) => ({
      letter,
      title: `Group ${letter}`,
      matches: (groups.get(letter) || []).slice().sort(matchSort),
    }))
}

type LayoutMode = 'single' | 'double'

function layoutModeFor(groupCount: number): LayoutMode {
  // Many groups → two columns so A4 sheets stay compact
  return groupCount >= 5 ? 'double' : 'single'
}

type DrawCtx = {
  doc: ReturnType<typeof newA4Doc>
  left: number
  colW: number
  rowH: number
  titleSize: number
  bodySize: number
  compact: boolean
}

function estimateGroupHeight(block: FixtureGroupBlock, rowH: number, gap: number) {
  // title + header + rows + bottom gap
  return 6 + 4.5 + block.matches.length * rowH + gap
}

function drawGroupBlock(ctx: DrawCtx, block: FixtureGroupBlock, x: number, y: number): number {
  const { doc, colW, rowH, titleSize, bodySize, compact } = ctx
  const timeW = compact ? 12 : 14
  const courtW = compact ? 18 : 22
  const pad = 1.2
  let cy = y

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(titleSize)
  doc.setTextColor(ACCENT)
  doc.text(block.title, x, cy + 3.5)
  cy += 5.5

  doc.setDrawColor(LINE)
  doc.setLineWidth(0.2)
  doc.line(x, cy, x + colW, cy)
  cy += 3.2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(bodySize - 0.6)
  doc.setTextColor(MUTED)
  doc.text('Time', x, cy)
  doc.text('Court', x + timeW, cy)
  doc.text('Match', x + timeW + courtW, cy)
  cy += 3.8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(bodySize)
  doc.setTextColor(INK)

  for (const m of block.matches) {
    const time = formatTime(m.scheduled_start)
    const court = courtLabel(m.court_name, m.court_number)
    const match = matchLine(m)
    const matchMax = colW - timeW - courtW - pad
    const matchLines = wrapText(doc, match, matchMax)
    const used = Math.max(rowH, matchLines.length * (bodySize * 0.42) + 1.2)

    doc.setTextColor(INK)
    doc.setFont('helvetica', 'bold')
    doc.text(time, x, cy)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(MUTED)
    doc.text(court, x + timeW, cy)
    doc.setTextColor(INK)
    doc.text(matchLines[0] || '', x + timeW + courtW, cy)
    for (let i = 1; i < matchLines.length; i++) {
      doc.text(matchLines[i], x + timeW + courtW, cy + i * (bodySize * 0.42))
    }
    cy += used
  }

  return cy + (compact ? 2.5 : 4)
}

type PagePlan = { columns: FixtureGroupBlock[][] }

function planPages(blocks: FixtureGroupBlock[], mode: LayoutMode): PagePlan[] {
  const pageH = A4.h
  const header = 22
  const usable = pageH - PDF_MARGIN * 2 - header
  const compact = mode === 'double'
  const rowH = compact ? 4.4 : 5.2
  const gap = compact ? 3 : 4.5
  const heights = blocks.map((b) => estimateGroupHeight(b, rowH, gap))

  if (mode === 'single') {
    const pages: PagePlan[] = []
    let col: FixtureGroupBlock[] = []
    let used = 0
    for (let i = 0; i < blocks.length; i++) {
      const h = heights[i]
      if (col.length && used + h > usable) {
        pages.push({ columns: [col] })
        col = []
        used = 0
      }
      col.push(blocks[i])
      used += h
    }
    if (col.length) pages.push({ columns: [col] })
    return pages
  }

  // Double column: fill left then right like newspaper columns, page by page
  const pages: PagePlan[] = []
  let left: FixtureGroupBlock[] = []
  let right: FixtureGroupBlock[] = []
  let leftH = 0
  let rightH = 0

  const flush = () => {
    if (left.length || right.length) pages.push({ columns: [left, right] })
    left = []
    right = []
    leftH = 0
    rightH = 0
  }

  for (let i = 0; i < blocks.length; i++) {
    const h = heights[i]
    const preferLeft = leftH <= rightH
    if (preferLeft) {
      if (left.length && leftH + h > usable) {
        if (rightH + h <= usable) {
          right.push(blocks[i])
          rightH += h
          continue
        }
        flush()
      }
      left.push(blocks[i])
      leftH += h
    } else {
      if (right.length && rightH + h > usable) {
        if (leftH + h <= usable) {
          left.push(blocks[i])
          leftH += h
          continue
        }
        flush()
        left.push(blocks[i])
        leftH += h
        continue
      }
      right.push(blocks[i])
      rightH += h
    }
  }
  flush()
  return pages
}

export function downloadGroupFixturesPdf(opts: {
  tournamentName: string
  venue?: string | null
  whenLabel?: string
  matches: Match[]
}) {
  const blocks = buildGroupFixtureBlocks(opts.matches)
  if (!blocks.length) {
    throw new Error('No group fixtures to download yet.')
  }

  const mode = layoutModeFor(blocks.length)
  const pages = planPages(blocks, mode)
  const doc = newA4Doc(`${opts.tournamentName} — group fixtures`)
  const gutter = 4
  const contentW = A4.w - PDF_MARGIN * 2
  const colW = mode === 'double' ? (contentW - gutter) / 2 : contentW
  const compact = mode === 'double'
  const ctx: DrawCtx = {
    doc,
    left: PDF_MARGIN,
    colW,
    rowH: compact ? 4.4 : 5.2,
    titleSize: compact ? 10 : 11.5,
    bodySize: compact ? 7.6 : 8.6,
    compact,
  }

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) doc.addPage()
    let y = PDF_MARGIN

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(ACCENT)
    const titleLines = wrapText(doc, opts.tournamentName, contentW)
    doc.text(titleLines[0] || opts.tournamentName, PDF_MARGIN, y + 4)
    y += 8

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(MUTED)
    const meta = [
      opts.venue,
      opts.whenLabel,
      'Group stage fixtures',
      pages.length > 1 ? `Page ${pageIndex + 1} of ${pages.length}` : null,
      mode === 'double' ? 'Compact layout' : null,
    ]
      .filter(Boolean)
      .join(' · ')
    doc.text(meta, PDF_MARGIN, y)
    y += 6
    doc.setDrawColor(LINE)
    doc.line(PDF_MARGIN, y, A4.w - PDF_MARGIN, y)
    y += 5

    if (mode === 'single') {
      let cy = y
      for (const block of page.columns[0] || []) {
        cy = drawGroupBlock(ctx, block, PDF_MARGIN, cy)
      }
    } else {
      const xs = [PDF_MARGIN, PDF_MARGIN + colW + gutter]
      page.columns.forEach((colBlocks, colIndex) => {
        let cy = y
        for (const block of colBlocks) {
          cy = drawGroupBlock({ ...ctx, left: xs[colIndex] }, block, xs[colIndex], cy)
        }
      })
    }
  })

  savePdf(doc, `${pdfSafeFilename(opts.tournamentName)}-group-fixtures.pdf`)
}
