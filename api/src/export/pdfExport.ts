/**
 * pdfExport.ts
 *
 * Converts ResumeContent → ATS-readable PDF using Puppeteer (headless Chrome).
 * Puppeteer produces TrueType fonts with proper Unicode maps (pdffonts: "uni: yes"),
 * so ATS systems can extract and search the text — unlike html2canvas/jsPDF which
 * produces image-only PDFs (pdffonts: "Type 3 / uni: no").
 *
 * Regression guard: after generating the PDF, pdf-parse extracts the text layer
 * and asserts that the candidate's name and at least 5 resume keywords are present.
 * If the assertion fails the PDF is rejected — fail loudly rather than silently ship
 * an unreadable file.
 */

import puppeteer from 'puppeteer';
// pdf-parse v2: PDFParse class takes { url } and has a .getText() method
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse');

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import os from 'os';

async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const tmpPath = join(os.tmpdir(), `pdf_regression_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(tmpPath, pdfBuffer);
  try {
    const parser = new PDFParse({ url: `file:///${tmpPath.replace(/\\/g, '/')}` });
    const result = await parser.getText() as { text: string };
    return result.text || '';
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
}

interface ResumeContent {
  header: { name: string; title: string; phone: string; email: string; linkedin: string; github: string; portfolio: string };
  summary: string;
  showSummary: boolean;
  sections: Array<{
    id: string; type: string; title: string; visible: boolean;
    items: Array<{
      id: string;
      organization?: string; role?: string; location?: string; date?: string;
      bullets?: { id: string; text: string }[];
      projectName?: string; techStack?: string; dateRange?: string;
      category?: string; items?: string;
      content?: string;
    }>;
  }>;
}

// ── Regression guard ─────────────────────────────────────────────────────────

function collectKeywords(content: ResumeContent): string[] {
  const words = new Set<string>();

  // Candidate name words
  for (const w of (content.header.name || '').split(/\s+/).filter(Boolean)) {
    words.add(w.toLowerCase());
  }

  // Skill items from skills sections
  for (const section of content.sections) {
    if (!section.visible) continue;
    if (section.type === 'skills') {
      for (const item of section.items) {
        for (const skill of (item.items || '').split(',')) {
          const s = skill.trim();
          if (s.length > 2) words.add(s.toLowerCase());
        }
      }
    }
    // Org and role names
    if (section.type === 'experience' || section.type === 'education') {
      for (const item of section.items) {
        if (item.organization?.trim()) words.add(item.organization.trim().toLowerCase());
        if (item.role?.trim()) words.add(item.role.split(/[\s,]/)[0].toLowerCase());
      }
    }
    if (section.type === 'projects') {
      for (const item of section.items) {
        if (item.projectName?.trim()) words.add(item.projectName.trim().toLowerCase());
      }
    }
  }

  return [...words].filter(w => w.length > 2);
}

async function assertTextLayer(pdfBuffer: Buffer, content: ResumeContent): Promise<void> {
  let extracted: string;
  try {
    extracted = (await extractPdfText(pdfBuffer)).toLowerCase();
  } catch (err: any) {
    throw new Error(`Regression guard: text extraction failed — ${err.message}`);
  }

  if (!extracted.trim()) {
    throw new Error('Regression guard: PDF has no extractable text layer (ATS-fatal)');
  }

  const keywords = collectKeywords(content);
  const found = keywords.filter(k => extracted.includes(k));
  const notFound = keywords.filter(k => !extracted.includes(k));

  if (found.length < 5) {
    throw new Error(
      `Regression guard: PDF text layer too sparse — only ${found.length}/${keywords.length} keywords found. ` +
      `Missing: ${notFound.slice(0, 10).join(', ')}`
    );
  }
}

// ── Puppeteer renderer ────────────────────────────────────────────────────────

let browserInstance: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  return browserInstance;
}

// Graceful shutdown
process.on('exit', () => { browserInstance?.close().catch(() => {}); });
process.on('SIGINT', () => { browserInstance?.close().catch(() => {}); process.exit(0); });

export async function generatePdf(html: string, content: ResumeContent): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait for fonts to load before capturing
    await page.evaluate(() => (document as any).fonts.ready);

    const pdfBuffer = Buffer.from(
      await page.pdf({
        format: 'Letter',          // 8.5in × 11in
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      })
    );

    // ── Regression guard ─────────────────────────────────────────────────────
    // Asserts the PDF has a real text layer with the candidate's keywords.
    // If this throws, we refuse to serve the PDF — fail loudly.
    await assertTextLayer(pdfBuffer, content);

    return pdfBuffer;
  } finally {
    await page.close();
  }
}
