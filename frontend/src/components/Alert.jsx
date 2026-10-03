// Status messaging always pairs an icon with text, never colour alone.
const STYLES = {
  error: { border: '#d03b3b', icon: '×', label: 'Error' },
  success: { border: '#0ca30c', icon: '✓', label: 'Success' },
};

export default function Alert({ kind = 'error', children }) {
  if (!children) return null;
  const style = STYLES[kind] || STYLES.error;

  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className="mb-4 flex items-start gap-2 rounded border-l-2 bg-plane px-3 py-2 text-sm text-ink-secondary"
      style={{ borderLeftColor: style.border }}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: style.border }}
      >
        {style.icon}
      </span>
      <span>
        <span className="sr-only">{style.label}: </span>
        {children}
      </span>
    </p>
  );
}
