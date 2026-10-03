export default function Card({ title, action, children, className = '' }) {
  return (
    <section className={`rounded-lg border border-hairline bg-surface p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
