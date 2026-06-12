import { useCallback, useEffect, useRef } from 'react';
import type { ResumeSettings } from '@/types/resume.types';

// US Letter height at 96 dpi
const PAGE_HEIGHT_PX = 1056;

interface UseAutoFitOptions {
  previewRef: React.RefObject<HTMLDivElement | null>;
  settings: ResumeSettings;
  setSettings: (settings: ResumeSettings) => void;
  enabled: boolean;
}

export function useAutoFit({ previewRef, settings, setSettings, enabled }: UseAutoFitOptions) {
  const runningRef = useRef(false);

  const tryFit = useCallback(() => {
    const el = previewRef.current;
    if (!el || !enabled || runningRef.current) return;

    const contentHeight = el.scrollHeight;
    if (contentHeight <= PAGE_HEIGHT_PX) return; // already fits

    runningRef.current = true;

    // Binary search: try to find the largest fontSize (9–11) and lineSpacing (1.0–1.15)
    // that fits in one page.
    const originalFontSize = settings.fontSize;
    const originalLineSpacing = settings.lineSpacing;

    let lo = 9;
    let hi = Math.min(settings.fontSize, 11);
    let bestFontSize = lo;

    // Synchronously set styles and measure
    const measure = (fs: number, ls: number): number => {
      el.style.fontSize = `${fs}pt`;
      el.style.lineHeight = String(ls);
      return el.scrollHeight;
    };

    const restore = () => {
      el.style.fontSize = '';
      el.style.lineHeight = '';
    };

    // Binary search on fontSize with fixed lineSpacing = 1.0
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const h = measure(mid, 1.0);
      if (h <= PAGE_HEIGHT_PX) {
        bestFontSize = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    restore();
    runningRef.current = false;

    // Apply the found values if they're smaller than current
    if (bestFontSize < originalFontSize || originalLineSpacing > 1.0) {
      setSettings({
        ...settings,
        fontSize: Math.round(bestFontSize * 10) / 10,
        lineSpacing: 1.0,
      });
    }
  }, [previewRef, settings, setSettings, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const el = previewRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      tryFit();
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, previewRef, tryFit]);
}
