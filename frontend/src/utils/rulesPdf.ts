import { A4, PDF_MARGIN, newA4Doc, pdfSafeFilename, savePdf, wrapText } from './a4Pdf'
import {
  PADEL_RULES_FOOTER,
  PADEL_RULES_INTRO,
  PADEL_RULES_SECTIONS,
} from './padelRulesContent'
import { scoringModeLabel } from './matchRules'

const INK = '#14201c'
const MUTED = '#5a6b64'
const ACCENT = '#0b3d2e'

export function downloadCommonPadelRulesPdf() {
  const doc = newA4Doc('Common padel rules')
  const pageW = A4.w
  const pageH = A4.h
  const left = PDF_MARGIN
  const right = pageW - PDF_MARGIN
  const maxW = right - left
  let y = PDF_MARGIN

  const ensure = (need: number) => {
    if (y + need <= pageH - PDF_MARGIN) return
    doc.addPage()
    y = PDF_MARGIN
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(ACCENT)
  doc.text('Common padel rules', left, y + 6)
  y += 12

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(MUTED)
  for (const line of wrapText(doc, PADEL_RULES_INTRO, maxW)) {
    ensure(5)
    doc.text(line, left, y)
    y += 4.2
  }
  y += 3

  for (const section of PADEL_RULES_SECTIONS) {
    ensure(10)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(ACCENT)
    doc.text(section.title, left, y)
    y += 5.5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.2)
    doc.setTextColor(INK)
    for (const bullet of section.bullets) {
      const lines = wrapText(doc, `• ${bullet}`, maxW)
      ensure(lines.length * 4.1 + 1)
      for (const line of lines) {
        doc.text(line, left, y)
        y += 4.1
      }
      y += 0.6
    }
    y += 2.2
  }

  ensure(14)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(MUTED)
  for (const line of wrapText(doc, PADEL_RULES_FOOTER, maxW)) {
    ensure(4)
    doc.text(line, left, y)
    y += 3.8
  }

  savePdf(doc, 'student-padel-common-rules.pdf')
}

type EventRulesInput = {
  name: string
  venue?: string | null
  eventDateLabel?: string
  matchDurationMinutes?: number | null
  scoringMode?: string | null
  pointsToWin?: number | null
  rules?: string | null
}

export function downloadEventRulesPdf(input: EventRulesInput) {
  const doc = newA4Doc(`${input.name} — match rules`)
  const left = PDF_MARGIN
  const maxW = A4.w - PDF_MARGIN * 2
  let y = PDF_MARGIN

  const ensure = (need: number) => {
    if (y + need <= A4.h - PDF_MARGIN) return
    doc.addPage()
    y = PDF_MARGIN
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(ACCENT)
  doc.text(wrapText(doc, input.name, maxW)[0] || input.name, left, y + 5)
  y += 10

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(MUTED)
  const meta = [input.venue, input.eventDateLabel].filter(Boolean).join(' · ')
  if (meta) {
    doc.text(meta, left, y)
    y += 6
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(ACCENT)
  doc.text('Match format & rules', left, y)
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(INK)
  const bullets: string[] = []
  if (input.matchDurationMinutes) {
    bullets.push(`About ${input.matchDurationMinutes} minutes per match`)
  }
  bullets.push(scoringModeLabel(input.scoringMode, input.pointsToWin))
  for (const b of bullets) {
    ensure(5)
    doc.text(`• ${b}`, left, y)
    y += 5
  }
  y += 3

  const body = (input.rules || '').trim() || 'Scoring details will be confirmed on the day.'
  doc.setFontSize(9.5)
  for (const para of body.split(/\n+/)) {
    const lines = wrapText(doc, para, maxW)
    ensure(lines.length * 4.2 + 2)
    for (const line of lines) {
      doc.text(line, left, y)
      y += 4.2
    }
    y += 2
  }

  y += 4
  ensure(10)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(MUTED)
  doc.text('Also see: Common padel rules (serve, glass, mesh) on studentpadel.ie/padel-rules', left, y)

  savePdf(doc, `${pdfSafeFilename(input.name)}-rules.pdf`)
}
