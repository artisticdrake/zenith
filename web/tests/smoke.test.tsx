import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';

describe('harness smoke', () => {
  it('renders a component and finds it in the DOM', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('has working sessionStorage/localStorage', () => {
    sessionStorage.setItem('k', 'v');
    expect(sessionStorage.getItem('k')).toBe('v');
  });

  it('exposes import.meta.env vite vars', () => {
    expect(import.meta.env.VITE_API_URL).toBe('http://localhost:3000');
  });
});
