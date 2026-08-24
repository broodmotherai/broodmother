import type { ReactNode } from "react";

// The name of the one thing a detail page is about, set at the weight of a
// section heading rather than a page title.
//
// The rail already says where you are, which is why the settings page carries no
// page title at all. A detail page needs one — the rail cannot say *which*
// policy — but it is the same size as everything else on the page, because it is
// a label on the content and not a banner over it.
const head = "flex items-center justify-between gap-3 border-b border-sand pb-2 text-[13px] font-bold text-charcoal";
const note = "mt-2 text-xs text-muted";

export default function PanelHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8">
      <div className={head}>
        <span className="min-w-0 truncate">{title}</span>
        {actions && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
      </div>
      {description && <div className={note}>{description}</div>}
    </header>
  );
}
