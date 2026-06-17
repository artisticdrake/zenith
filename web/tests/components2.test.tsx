import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SectionList from '@/components/resume/editor/SectionList';
import ApplicationsTab from '@/components/tabs/ApplicationsTab';
import AnalyticsTab from '@/components/tabs/AnalyticsTab';
import AppDetailModal from '@/components/modals/AppDetailModal';
import { DEFAULT_RESUME_CONTENT, type ResumeContent } from '@/types/resume.types';
import type { JobApplication } from '@/lib/types';

// ── SectionList ──────────────────────────────────────────────────────────────

function SectionListHarness() {
  const [content, setContent] = useState<ResumeContent>({
    ...DEFAULT_RESUME_CONTENT,
    sections: [{ id: 's1', type: 'experience', title: 'Experience', visible: true, items: [] }],
  });
  return (
    <div>
      <SectionList content={content} onChange={setContent} />
      <output data-testid="count">{content.sections.length}</output>
      <output data-testid="titles">{content.sections.map(s => s.title).join(',')}</output>
      <output data-testid="vis">{String(content.sections[0]?.visible)}</output>
    </div>
  );
}

describe('SectionList', () => {
  it('adds a new section of each type', async () => {
    const user = userEvent.setup();
    render(<SectionListHarness />);
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: '+ Projects' }));
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(screen.getByTestId('titles')).toHaveTextContent('Projects');
  });

  it('edits a section title', async () => {
    const user = userEvent.setup();
    render(<SectionListHarness />);
    const title = screen.getByLabelText('Section title');
    await user.clear(title);
    await user.type(title, 'Work History');
    expect(screen.getByTestId('titles')).toHaveTextContent('Work History');
  });

  it('toggles visibility and deletes a section', async () => {
    const user = userEvent.setup();
    render(<SectionListHarness />);
    await user.click(screen.getByRole('switch')); // visible -> hidden
    expect(screen.getByTestId('vis')).toHaveTextContent('false');
    await user.click(screen.getByLabelText('Delete section'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});

// ── ApplicationsTab ──────────────────────────────────────────────────────────

function makeApp(over: Partial<JobApplication> = {}): JobApplication {
  return {
    id: 'a1', company: 'Acme', position: 'ML Engineer', location: 'NYC', salary: '',
    dateApplied: '2026-06-01', status: 'Applied', source: 'LinkedIn', referral: 'No',
    jobUrl: '', jobDescription: '', notes: '', documents: [],
    timeline: [{ status: 'Applied', ts: Date.now() }], last_updated: '2026-06-01',
    ...over,
  };
}

function appsTabProps(over = {}) {
  const apps = [makeApp(), makeApp({ id: 'a2', company: 'Globex', position: 'Data Scientist' })];
  return {
    apps,
    sortedApps: apps,
    stats: { total: 2, statusCounts: { Applied: 2 } },
    loading: false,
    searchTerm: '',
    setSearchTerm: vi.fn(),
    onAddNew: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onRowClick: vi.fn(),
    aiSummary: '',
    loadingSummary: false,
    onRefreshSummary: vi.fn(),
    ...over,
  };
}

describe('ApplicationsTab', () => {
  it('renders applications (tailoring score badge removed — scores live in the builder)', () => {
    render(<ApplicationsTab {...appsTabProps()} />);
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
    expect(screen.getByText('Globex')).toBeInTheDocument();
    // No tailoring-score badge column anymore
    expect(screen.queryByText('88')).not.toBeInTheDocument();
  });

  it('typing in search calls setSearchTerm; Add fires onAddNew', async () => {
    const user = userEvent.setup();
    const p = appsTabProps();
    render(<ApplicationsTab {...p} />);
    const search = screen.getByPlaceholderText(/Search/i);
    await user.type(search, 'glob');
    expect(p.setSearchTerm).toHaveBeenCalled();
  });

  it('shows empty state when there are no apps', () => {
    render(<ApplicationsTab {...appsTabProps({ apps: [], sortedApps: [], stats: { total: 0, statusCounts: {} } })} />);
    // No company rows rendered
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
  });
});

// ── AnalyticsTab ─────────────────────────────────────────────────────────────

describe('AnalyticsTab', () => {
  const stats: any = {
    total: 10, statusCounts: { Applied: 5, Offer: 1 }, sourceCounts: { LinkedIn: 6 },
    weeks: [{ week: '2026-06-01', count: 3 }], medianSalary: 120000,
    responseRate: '40.0', avgResponseTime: '5.0',
    screeningConversion: '50.0', interviewConversion: '30.0', offerConversion: '20.0',
  };
  const pieData = [{ name: 'Applied', value: 5 }, { name: 'Offer', value: 1 }];
  const sourceData = [{ name: 'LinkedIn', value: 6 }];
  const monthData = [{ month: "Jun '26", count: 10 }];

  it('renders KPI labels without crashing', () => {
    render(<AnalyticsTab stats={stats} pieData={pieData} sourceData={sourceData} monthData={monthData} />);
    expect(screen.getByText(/Response Rate/i)).toBeInTheDocument();
  });
});

// ── AppDetailModal ───────────────────────────────────────────────────────────

describe('AppDetailModal', () => {
  it('renders nothing when app is null', () => {
    const { container } = render(<AppDetailModal app={null} onClose={vi.fn()} onEdit={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders details and fires edit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<AppDetailModal app={makeApp({ company: 'Acme', position: 'ML Engineer' })} onClose={vi.fn()} onEdit={onEdit} />);
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
    expect(screen.getByText('ML Engineer')).toBeInTheDocument();
    const editBtn = screen.getByRole('button', { name: /Edit/i });
    await user.click(editBtn);
    expect(onEdit).toHaveBeenCalled();
  });
});
