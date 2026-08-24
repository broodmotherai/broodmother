import type { HTMLAttributes, ReactNode } from "react";

/** The timing everything that opens and shuts shares, so a caret and the panel
 * it turns over move together. */
export const snap = "duration-[260ms] ease-snap motion-reduce:transition-none";

type Props = HTMLAttributes<HTMLDivElement> & {
  open: boolean;
  /** Sits on the inner box, which is the one that may not keep its padding
   * while shut. Anything that only applies open belongs in `openClassName`. */
  className?: string;
  openClassName?: string;
  children: ReactNode;
};

/**
 * Opens and shuts to fit its content. A grid row animated between 1fr and 0fr
 * is the one way to transition to a height nothing has measured; the inner box
 * carries min-h-0 so the row is free to be shorter than what it holds.
 */
export default function Collapse({ open, className, openClassName, children, ...rest }: Props) {
  return (
    <div className={`grid transition-[grid-template-rows] ${snap} ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} inert={!open}>
      <div
        {...rest}
        className={`min-h-0 overflow-hidden transition-[opacity,padding] ${snap} ${open ? `opacity-100 delay-[60ms] ${openClassName ?? ""}` : "opacity-0"} ${className ?? ""}`}
      >
        {children}
      </div>
    </div>
  );
}
