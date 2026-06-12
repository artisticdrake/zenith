interface Props {
  overflow: boolean;
}

export default function PageOverflowWarning({ overflow }: Props) {
  if (overflow) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          background: '#fef2f2',
          border: '1px solid #fca5a5',
          borderRadius: '6px',
          fontSize: '12px',
          color: '#dc2626',
          marginBottom: '8px',
        }}
      >
        <span>⚠</span>
        <span>Content exceeds one page — enable Auto-Fit or reduce content</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        background: '#f0fdf4',
        border: '1px solid #86efac',
        borderRadius: '6px',
        fontSize: '12px',
        color: '#16a34a',
        marginBottom: '8px',
      }}
    >
      <span>✓</span>
      <span>Fits one page</span>
    </div>
  );
}
