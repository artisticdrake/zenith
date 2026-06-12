/**
 * generatePDF.ts
 *
 * Downloads a text-native PDF via the server-side Puppeteer endpoint (POST /export/pdf).
 * The server renders the resume HTML with headless Chrome, which embeds fonts as
 * TrueType with proper Unicode maps — ATS systems can extract clean text.
 *
 * The old html2canvas + jsPDF path has been removed because it produced image-only PDFs
 * (pdffonts: "Type 3 / uni: no") that ATS systems read as blank.
 */

import type { ResumeContent, ResumeSettings } from '@/types/resume.types';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface UsePDFExportOptions {
  versionName: string;
  content: ResumeContent;
  settings: ResumeSettings;
  token: string;
}

export function usePDFExport({ versionName, content, settings, token }: UsePDFExportOptions) {
  return async () => {
    const res = await fetch(`${API}/export/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content, settings }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? `PDF export failed: HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(versionName || 'Resume').replace(/[^a-zA-Z0-9 _-]/g, '_')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
}
