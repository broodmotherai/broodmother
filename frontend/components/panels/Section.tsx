import type { ReactNode } from "react";

const card = "min-w-0 [&+&]:mt-8";
const cardHead = "flex items-center justify-between gap-3 border-b border-sand pb-2 text-[13px] font-bold text-charcoal";
const note = "mt-2 text-xs text-muted";

export default function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={card}>
      <header className={cardHead}>
        <span className="min-w-0 truncate">{title}</span>
        {actions && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
      </header>
      {description && <p className={note}>{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
