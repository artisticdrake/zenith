import { type RefObject, useEffect, useState } from 'react';
import type { ResumeContent, ResumeSettings } from '@/types/resume.types';
import ResumePreview from './ResumePreview';
import PageOverflowWarning from './PageOverflowWarning';

interface Props {
  previewRef: RefObject<HTMLDivElement | null>;
  content: ResumeContent;
  settings: ResumeSettings;
}

const PAGE_HEIGHT_PX = 1056; // 11in at 96dpi

const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0, 1.1, 1.25, 1.5];
const DEFAULT_ZOOM_IDX = 7; // 1.0

export default function PreviewPanel({ previewRef, content, settings }: Props) {
  const [overflow, setOverflow] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_IDX);
  const zoom = ZOOM_STEPS[zoomIdx];

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      setOverflow(el.scrollHeight > PAGE_HEIGHT_PX);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [previewRef]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Zoom control bar */}
      <div
        className="shrink-0 flex items-center justify-end gap-1 px-3 py-1 border-b border-border bg-background"
      >
        <button
          type="button"
          disabled={zoomIdx === 0}
          onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
          className="h-6 w-6 flex items-center justify-center rounded text-sm text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="text-[11px] font-mono text-muted-foreground w-10 text-center select-none">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          disabled={zoomIdx === ZOOM_STEPS.length - 1}
          onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
          className="h-6 w-6 flex items-center justify-center rounded text-sm text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoomIdx(DEFAULT_ZOOM_IDX)}
          className="ml-1 h-6 px-2 text-[10px] text-muted-foreground hover:bg-muted rounded transition-colors"
          title="Reset zoom"
        >
          Reset
        </button>
      </div>

      <PageOverflowWarning overflow={overflow} />

      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{ background: '#e5e7eb' }}
      >
        <div className="flex justify-center py-6 px-4">
          <div
            style={{
              zoom,
              boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
              position: 'relative',
              transformOrigin: 'top center',
            }}
          >
            <ResumePreview ref={previewRef} content={content} settings={settings} />

            {/* Red overflow line at 11in */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '11in',
                borderTop: '2px dashed #ef4444',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
