import Link from "next/link";
import { Children, type ReactNode } from "react";

// A panel's list of things: one bordered card, hairlines between the
// rows, each row a name on the left and whatever acts on it on the right. The
// chrome is fixed and the width is not — placement belongs to the panel, the
// way it does for Facts.
const card = "flex list-none flex-col overflow-hidden rounded-md border border-sand";

const empty = "px-3 py-2.5 text-xs text-muted";

export default function PanelTable({ empty: emptyText, className, children }: { empty: ReactNode; className?: string; children: ReactNode }) {
  const isEmpty = Children.count(children) === 0;
  return <ul className={`${card} ${className ?? ""}`}>{isEmpty ? <li className={empty}>{emptyText}</li> : children}</ul>;
}

const row = "flex items-center justify-between gap-3 px-3 py-2.5 text-xs [&+&]:border-t [&+&]:border-surface-hover";
const label = "font-semibold text-foreground no-underline hover:text-link";
const pill = "shrink-0 rounded-full border border-sand px-1.5 py-px text-[10px] font-semibold text-muted";

type RowProps = {
  label: ReactNode;
  /** Makes the name the way into the thing. A row with nowhere to go reads as
   * plain text rather than a link that does nothing. */
  href?: string;
  /** A word about the row's state, shown beside the name. */
  badge?: ReactNode;
  /** What acts on this row, held to the right edge. */
  actions?: ReactNode;
  /** A second line under the name — an id, usually. */
  hint?: ReactNode;
};

export function PanelRow({ label: text, href, badge, actions, hint }: RowProps) {
  return (
    <li className={row}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0">
          {href ? (
            <Link href={href} className={`${label} block truncate`}>
              {text}
            </Link>
          ) : (
            <span className={`${label} block truncate`}>{text}</span>
          )}
          {hint && <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">{hint}</span>}
        </span>
        {badge && <span className={pill}>{badge}</span>}
      </span>
      {actions && <span className="flex shrink-0 items-center gap-3">{actions}</span>}
    </li>
  );
}
