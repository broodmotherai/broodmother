import Link from "next/link";
import { Children, type ReactNode } from "react";

// A panel's list of things: one bordered card, hairlines between the
// rows, each row a name on the left and whatever acts on it on the right. The
// chrome is fixed and the width is not — placement belongs to the panel, the
// way it does for Facts.
//
// The margin and padding are said rather than assumed: this app loads Tailwind's utilities
// without its reset, so a `ul` still carries the browser's own 40px indent and 1em of air —
// which reads as a card that has been nudged off the column it stands in.
const card = "m-0 flex list-none flex-col overflow-hidden rounded-md border border-sand p-0";

const empty = "px-[0.7rem] py-[0.55rem] text-[0.85rem] text-muted";

export default function PanelTable({ empty: emptyText, className, children }: { empty: ReactNode; className?: string; children: ReactNode }) {
  const isEmpty = Children.count(children) === 0;
  return <ul className={`${card} ${className ?? ""}`}>{isEmpty ? <li className={empty}>{emptyText}</li> : children}</ul>;
}

// The panel's own figures, not a scale of this card's own: the type is what the tables and
// fields around it are set in, which is also what a `font: inherit` button in the row picks
// up — so a Save beside a field is the same size and the same height as the field. The
// padding is cut for what a row holds now, a tile and two lines rather than one name.
const row = "flex items-center justify-between gap-3 px-[0.7rem] py-[0.55rem] text-[0.85rem] [&+&]:border-t [&+&]:border-surface-hover";
// A name is what the row is called, not something you can do to it — so it answers the
// pointer only where it is a way into something, which is to say only where it is a link.
const label = "font-semibold text-foreground no-underline";
const linked = `${label} hover:text-link`;
const pill = "shrink-0 rounded-full border border-sand px-1.5 py-px text-[0.7rem] font-semibold text-muted";

// The glyph a row is recognised by, in a tile the size of the two lines beside it. A square
// rather than a bare icon: a name and a command under it is a block of text, and a glyph set
// loose against it reads as part of the sentence instead of as the thing's mark.
//
// The mark is drawn at the size a thing's own mark is drawn at, not at the size of the app's
// furniture: this is what the row is picked out of the list by, and the 0.9rem glyph the
// rails wear is a chevron's size — right for something you look past, small for something
// you look for.
// No fill and no colour of its own: the card it stands in is the surface, and a mark that
// comes with a colour — an agent's, a provider's — wears it. The caller colours the glyph;
// this only says how big it is and what it is squared off by.
const tile = "grid size-8 shrink-0 place-items-center rounded-[var(--row-radius)] border border-[var(--line)] [&_.icon]:block [&_.icon]:size-[1.15rem]";

// What is true of the row rather than something you can do to it — where it applies, what it
// is signed in through. Muted, and held to the right with the actions, because it is read
// down the column rather than across the row.
const meta = "shrink-0 text-right text-[0.75rem] text-muted";

type RowProps = {
  label: ReactNode;
  /** Gives the name and the line under it the rest of the row, rather than only the width
   * they ask for. For a hint that is read — a command line, an address — where the row's
   * own width is what stands between reading it and squinting at it. */
  fill?: boolean;
  /** The thing's own mark, ahead of its name. */
  icon?: ReactNode;
  /** Makes the name the way into the thing. A row with nowhere to go reads as
   * plain text rather than a link that does nothing. */
  href?: string;
  /** A word about the row's state, shown beside the name. */
  badge?: ReactNode;
  /** What acts on this row, held to the right edge. */
  actions?: ReactNode;
  /** A second line under the name — an id, usually. */
  hint?: ReactNode;
  /** A standing fact about the row, at the right edge ahead of whatever acts on it. */
  meta?: ReactNode;
};

export function PanelRow({ label: text, icon, href, badge, actions, hint, meta: note, fill = false }: RowProps) {
  return (
    <li className={row}>
      <span className={`flex min-w-0 items-center gap-[0.6rem]${fill ? " flex-1" : ""}`}>
        {icon && <span className={tile}>{icon}</span>}
        <span className={`min-w-0${fill ? " flex-1" : ""}`}>
          {href ? (
            <Link href={href} className={`${linked} block truncate`}>
              {text}
            </Link>
          ) : (
            <span className={`${label} block truncate`}>{text}</span>
          )}
          {hint && <span className="block truncate font-mono text-[0.75rem] leading-[1.35] text-muted">{hint}</span>}
        </span>
        {badge && <span className={pill}>{badge}</span>}
      </span>
      {(note || actions) && (
        <span className="flex shrink-0 items-center gap-[0.5rem]">
          {note && <span className={meta}>{note}</span>}
          {actions}
        </span>
      )}
    </li>
  );
}
