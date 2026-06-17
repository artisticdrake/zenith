import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';

import PreviewHeader from '@/components/resume/preview/PreviewHeader';
import PreviewExperience from '@/components/resume/preview/PreviewExperience';
import PreviewProject from '@/components/resume/preview/PreviewProject';
import PreviewSkills from '@/components/resume/preview/PreviewSkills';
import PreviewSection from '@/components/resume/preview/PreviewSection';
import PageOverflowWarning from '@/components/resume/preview/PageOverflowWarning';
import ResumePreview from '@/components/resume/preview/ResumePreview';
import { DEFAULT_RESUME_CONTENT, DEFAULT_SETTINGS, type ResumeHeader } from '@/types/resume.types';

const baseHeader: ResumeHeader = {
  name: 'Jane Doe', title: 'ML Engineer',
  phone: '617-555-0000', email: 'jane@x.io',
  linkedin: 'linkedin.com/in/jane', github: 'github.com/jane', portfolio: 'jane.dev',
};

describe('PreviewHeader', () => {
  it('renders email/linkedin/github/portfolio as links and phone as plain text', () => {
    const { container } = render(<PreviewHeader header={baseHeader} fontSize={10} />);
    const links = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(links).toContain('mailto:jane@x.io');
    expect(links).toContain('https://linkedin.com/in/jane');
    expect(links).toContain('https://github.com/jane');
    expect(links).toContain('https://jane.dev');
    // phone is present as text but not a link
    expect(screen.getByText(/617-555-0000/)).toBeInTheDocument();
    expect(links).not.toContain('tel:6175550000');
  });

  it('shows placeholder name when empty', () => {
    render(<PreviewHeader header={{ ...baseHeader, name: '' }} fontSize={10} />);
    expect(screen.getByText('Your Name')).toBeInTheDocument();
  });

  it('omits contacts that are empty', () => {
    const { container } = render(
      <PreviewHeader header={{ ...baseHeader, github: '', portfolio: '' }} fontSize={10} />
    );
    const links = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(links).not.toContain('https://github.com/jane');
    expect(links).not.toContain('https://jane.dev');
  });
});

describe('PreviewExperience', () => {
  it('renders org/date/role/location and markdown bullets', () => {
    const item = {
      id: 'e1', organization: 'Acme', date: '2024', role: 'Engineer', location: 'NYC',
      bullets: [{ id: 'b', text: 'Shipped **fast** features' }],
    };
    const { container } = render(<PreviewExperience item={item} fontSize={10} lineSpacing={1.2} />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.getByText('NYC')).toBeInTheDocument();
    expect(container.querySelector('strong')?.textContent).toBe('fast');
  });
});

describe('PreviewProject', () => {
  it('renders name, tech stack and date', () => {
    const item = { id: 'p', projectName: 'Chatalogue', techStack: 'Python', dateRange: '2025', bullets: [] };
    render(<PreviewProject item={item} fontSize={10} lineSpacing={1.2} />);
    expect(screen.getByText('Chatalogue')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
  });
});

describe('PreviewSkills', () => {
  it('renders category: items and filters out empty rows', () => {
    const items = [
      { id: 's1', category: 'Languages', items: 'Python, SQL' },
      { id: 's2', category: '', items: '' }, // should be filtered
      { id: 's3', category: 'Tools', items: '' }, // missing items → filtered
    ];
    const { container } = render(<PreviewSkills items={items} fontSize={10} lineSpacing={1.2} />);
    expect(screen.getByText('Languages:')).toBeInTheDocument();
    expect(screen.getByText('Python, SQL')).toBeInTheDocument();
    expect(container.querySelectorAll('li')).toHaveLength(1);
  });
});

describe('PreviewSection', () => {
  it('hidden section renders nothing', () => {
    const { container } = render(
      <PreviewSection section={{ id: 's', type: 'experience', title: 'X', visible: false, items: [] }} settings={DEFAULT_SETTINGS} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('custom section renders markdown links', () => {
    const { container } = render(
      <PreviewSection
        section={{ id: 's', type: 'custom', title: 'Links', visible: true, items: [{ id: 'i', content: 'See [site](https://me.dev)' }] }}
        settings={DEFAULT_SETTINGS}
      />
    );
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://me.dev');
    expect(a?.textContent).toBe('site');
  });
});

describe('PageOverflowWarning', () => {
  it('shows the overflow message when overflowing', () => {
    render(<PageOverflowWarning overflow={true} />);
    expect(screen.getByText(/Content exceeds one page/)).toBeInTheDocument();
  });
  it('shows the fits message otherwise', () => {
    render(<PageOverflowWarning overflow={false} />);
    expect(screen.getByText(/Fits one page/)).toBeInTheDocument();
  });
});

describe('ResumePreview', () => {
  it('renders header, summary (with markdown), and sections', () => {
    const ref = createRef<HTMLDivElement>();
    const content = {
      ...DEFAULT_RESUME_CONTENT,
      header: baseHeader,
      summary: 'Portfolio at [here](https://me.dev)',
      showSummary: true,
    };
    const { container } = render(<ResumePreview ref={ref} content={content} settings={DEFAULT_SETTINGS} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
    // summary markdown link rendered
    const summaryLink = Array.from(container.querySelectorAll('a')).find(a => a.textContent === 'here');
    expect(summaryLink?.getAttribute('href')).toBe('https://me.dev');
    // section titles from default content
    expect(screen.getByText('Education')).toBeInTheDocument();
  });

  it('hides the summary block when showSummary is false', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ResumePreview ref={ref} content={{ ...DEFAULT_RESUME_CONTENT, showSummary: false }} settings={DEFAULT_SETTINGS} />);
    expect(screen.queryByText('Summary')).not.toBeInTheDocument();
  });
});
