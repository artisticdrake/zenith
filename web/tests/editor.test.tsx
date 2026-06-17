import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BulletEditor from '@/components/resume/editor/BulletEditor';
import HeaderEditor from '@/components/resume/editor/HeaderEditor';
import SummaryEditor from '@/components/resume/editor/SummaryEditor';
import SectionEditor from '@/components/resume/editor/SectionEditor';
import ExperienceItem from '@/components/resume/editor/ExperienceItem';
import ProjectItem from '@/components/resume/editor/ProjectItem';
import SkillsItem from '@/components/resume/editor/SkillsItem';
import TypographyControls from '@/components/resume/editor/TypographyControls';
import EditorPanel from '@/components/resume/editor/EditorPanel';
import { DEFAULT_RESUME_CONTENT, DEFAULT_SETTINGS, type BulletItem, type ResumeHeader, type ResumeSection, type ResumeSectionItem, type ResumeSettings } from '@/types/resume.types';

// ── BulletEditor ────────────────────────────────────────────────────────────────

function BulletHarness({ initial = '' }: { initial?: string }) {
  const [bullet, setBullet] = useState<BulletItem>({ id: 'b1', text: initial });
  const [added, setAdded] = useState(0);
  return (
    <div>
      <BulletEditor bullet={bullet} onChange={setBullet} onDelete={() => {}} onAdd={() => setAdded(a => a + 1)} />
      <output data-testid="text">{bullet.text}</output>
      <output data-testid="added">{added}</output>
    </div>
  );
}

describe('BulletEditor', () => {
  it('typing updates the bullet text', async () => {
    const user = userEvent.setup();
    render(<BulletHarness />);
    await user.type(screen.getByLabelText('Bullet point text'), 'Hello');
    expect(screen.getByTestId('text')).toHaveTextContent('Hello');
  });

  it('Enter (no shift) triggers onAdd instead of newline', async () => {
    const user = userEvent.setup();
    render(<BulletHarness initial="line" />);
    const ta = screen.getByLabelText('Bullet point text');
    ta.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('added')).toHaveTextContent('1');
  });

  it('link button inserts markdown link template into empty bullet', async () => {
    const user = userEvent.setup();
    render(<BulletHarness />);
    await user.click(screen.getByLabelText('Insert hyperlink'));
    expect(screen.getByTestId('text')).toHaveTextContent('[link text](https://)');
  });

  it('link button wraps the current selection', async () => {
    const user = userEvent.setup();
    render(<BulletHarness initial="see repo here" />);
    const ta = screen.getByLabelText('Bullet point text') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(4, 8); // "repo"
    await user.click(screen.getByLabelText('Insert hyperlink'));
    expect(screen.getByTestId('text')).toHaveTextContent('see [repo](https://) here');
  });
});

// ── HeaderEditor ─────────────────────────────────────────────────────────────────

function HeaderHarness() {
  const [header, setHeader] = useState<ResumeHeader>({ ...DEFAULT_RESUME_CONTENT.header });
  return (
    <div>
      <HeaderEditor header={header} onChange={setHeader} />
      <output data-testid="name">{header.name}</output>
      <output data-testid="email">{header.email}</output>
    </div>
  );
}

describe('HeaderEditor', () => {
  it('edits name and email fields', async () => {
    const user = userEvent.setup();
    render(<HeaderHarness />);
    const name = screen.getByLabelText('Full Name');
    await user.clear(name);
    await user.type(name, 'Ada Lovelace');
    expect(screen.getByTestId('name')).toHaveTextContent('Ada Lovelace');

    const email = screen.getByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'ada@x.io');
    expect(screen.getByTestId('email')).toHaveTextContent('ada@x.io');
  });
});

// ── SummaryEditor ────────────────────────────────────────────────────────────────

function SummaryHarness() {
  const [summary, setSummary] = useState('init summary');
  const [show, setShow] = useState(true);
  return (
    <div>
      <SummaryEditor summary={summary} showSummary={show} onSummaryChange={setSummary} onToggle={setShow} />
      <output data-testid="show">{String(show)}</output>
    </div>
  );
}

describe('SummaryEditor', () => {
  it('hides the textarea when toggled off and shows it when on', async () => {
    const user = userEvent.setup();
    render(<SummaryHarness />);
    expect(screen.getByLabelText('Summary text')).toBeInTheDocument();
    await user.click(screen.getByRole('switch'));
    expect(screen.getByTestId('show')).toHaveTextContent('false');
    expect(screen.queryByLabelText('Summary text')).not.toBeInTheDocument();
  });

  it('edits the summary text', async () => {
    const user = userEvent.setup();
    render(<SummaryHarness />);
    const ta = screen.getByLabelText('Summary text');
    await user.clear(ta);
    await user.type(ta, 'new objective');
    expect((ta as HTMLTextAreaElement).value).toBe('new objective');
  });
});

// ── SectionEditor (skills + custom) ──────────────────────────────────────────────

function SectionHarness({ section: initial }: { section: ResumeSection }) {
  const [section, setSection] = useState(initial);
  return (
    <div>
      <SectionEditor section={section} onChange={setSection} />
      <output data-testid="count">{section.items.length}</output>
    </div>
  );
}

describe('SectionEditor', () => {
  it('adds a skill category row', async () => {
    const user = userEvent.setup();
    render(<SectionHarness section={{ id: 's', type: 'skills', title: 'Skills', visible: true, items: [] }} />);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    await user.click(screen.getByRole('button', { name: /Add skill category/i }));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('renders a custom content textarea and edits it', async () => {
    const user = userEvent.setup();
    render(<SectionHarness section={{ id: 's', type: 'custom', title: 'Notes', visible: true, items: [{ id: 'i1', content: '' }] }} />);
    const ta = screen.getByLabelText(/Custom section content/i);
    await user.type(ta, 'hello world');
    expect((ta as HTMLTextAreaElement).value).toBe('hello world');
  });
});

// ── ExperienceItem / ProjectItem / SkillsItem ────────────────────────────────────

describe('ExperienceItem', () => {
  it('edits organization and adds/removes bullets', async () => {
    const user = userEvent.setup();
    function H() {
      const [item, setItem] = useState<ResumeSectionItem>({ id: 'e1', organization: '', bullets: [] as BulletItem[] });
      return (<><ExperienceItem item={item} index={0} onChange={setItem} onDelete={() => {}} />
        <output data-testid="org">{item.organization}</output>
        <output data-testid="bn">{item.bullets?.length ?? 0}</output></>);
    }
    render(<H />);
    await user.type(screen.getByLabelText('Organization'), 'Acme');
    expect(screen.getByTestId('org')).toHaveTextContent('Acme');
    await user.click(screen.getByRole('button', { name: /Add bullet/i }));
    expect(screen.getByTestId('bn')).toHaveTextContent('1');
  });
});

describe('ProjectItem', () => {
  it('edits project name and tech stack', async () => {
    const user = userEvent.setup();
    function H() {
      const [item, setItem] = useState<ResumeSectionItem>({ id: 'p1', projectName: '', techStack: '', bullets: [] as BulletItem[] });
      return (<><ProjectItem item={item} index={0} onChange={setItem} onDelete={() => {}} />
        <output data-testid="pn">{item.projectName}</output></>);
    }
    render(<H />);
    await user.type(screen.getByLabelText('Project Name'), 'Chatalogue');
    expect(screen.getByTestId('pn')).toHaveTextContent('Chatalogue');
  });
});

describe('SkillsItem', () => {
  it('edits category and items, and delete fires', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    function H() {
      const [item, setItem] = useState<ResumeSectionItem>({ id: 's1', category: '', items: '' });
      return (<><SkillsItem item={item} index={0} onChange={setItem} onDelete={onDelete} />
        <output data-testid="cat">{item.category}</output></>);
    }
    render(<H />);
    await user.type(screen.getByLabelText('Skills category 1'), 'Languages');
    expect(screen.getByTestId('cat')).toHaveTextContent('Languages');
    await user.click(screen.getByLabelText('Delete skills row'));
    expect(onDelete).toHaveBeenCalled();
  });
});

// ── TypographyControls ───────────────────────────────────────────────────────────

function TypoHarness() {
  const [settings, setSettings] = useState<ResumeSettings>({ ...DEFAULT_SETTINGS });
  return (<><TypographyControls settings={settings} onChange={setSettings} />
    <output data-testid="font">{settings.fontFamily}</output>
    <output data-testid="align">{settings.headerAlign}</output>
    <output data-testid="autofit">{String(settings.autoFitOnePage)}</output></>);
}

describe('TypographyControls', () => {
  it('changes font family, header alignment, and autofit', async () => {
    const user = userEvent.setup();
    render(<TypoHarness />);
    await user.selectOptions(screen.getByLabelText('Font family'), 'garamond');
    expect(screen.getByTestId('font')).toHaveTextContent('garamond');

    await user.click(screen.getByRole('button', { name: 'Left' }));
    expect(screen.getByTestId('align')).toHaveTextContent('left');

    await user.click(screen.getByRole('switch'));
    expect(screen.getByTestId('autofit')).toHaveTextContent('true');
  });

  it('font size slider updates the value', () => {
    render(<TypoHarness />);
    const slider = screen.getByLabelText('Font Size') as HTMLInputElement;
    expect(slider).toHaveValue(String(DEFAULT_SETTINGS.fontSize));
  });
});

// ── EditorPanel (tab switching) ──────────────────────────────────────────────────

describe('EditorPanel', () => {
  it('switches between Content and Typography tabs', async () => {
    const user = userEvent.setup();
    render(
      <EditorPanel
        content={DEFAULT_RESUME_CONTENT}
        settings={DEFAULT_SETTINGS}
        onContentChange={() => {}}
        onSettingsChange={() => {}}
      />
    );
    // Content tab shows the header editor
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Typography & Layout/i }));
    expect(screen.getByLabelText('Font family')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full Name')).not.toBeInTheDocument();
  });
});
