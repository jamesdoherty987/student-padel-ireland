import { jsPDF } from 'jspdf'

export const A4 = { w: 210, h: 297 } as const
export const PDF_MARGIN = 12

export function newA4Doc(title: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  doc.setProperties({ title, creator: 'Student Padel Ireland' })
  return doc
}

export function pdfSafeFilename(name: string) {
  return name
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'download'
}

export function savePdf(doc: jsPDF, filename: string) {
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

/** Word-wrap helper using jsPDF font metrics. */
export function wrapText(doc: jsPDF, text: string, maxWidthMm: number): string[] {
  return doc.splitTextToSize(String(text || ''), maxWidthMm) as string[]
}
