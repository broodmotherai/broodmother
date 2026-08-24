import type { CSSProperties } from "react";

export type IconSpec = {
  d: string;
  activeD?: string;
  rotate?: number;
  strokeWidth?: number;
};

const STROKE = 1.75;

const ARROW = "M21 12h-9M8 12H4M9 6l-6 6 6 6M12 9l-3 3 3 3";
const ARROW_ACTIVE = "M18 12h-6M8 12H4M9 6l-6 6 6 6M14 7l-5 5 5 5";

const CARET = "M4 10l8 6 8-6M12 10l0 0 0 0";
const CARET_ACTIVE = "M4 10l8 6 8-6M6 5.5l6 4.5 6-4.5";

const ICONS = {
  "arrow-left": { d: ARROW, activeD: ARROW_ACTIVE },
  "arrow-right": { d: ARROW, activeD: ARROW_ACTIVE, rotate: 180 },
  "arrow-bottom-right": { d: ARROW, activeD: ARROW_ACTIVE, rotate: 225 },
  "arrow-top-right": { d: ARROW, activeD: ARROW_ACTIVE, rotate: 135 },
  "caret-down": { d: CARET, activeD: CARET_ACTIVE },
  "caret-up": { d: CARET, activeD: CARET_ACTIVE, rotate: 180 },
  bell: { d: "M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0" },
  book: { d: "M6 3h12v18H6zM6 17h12" },
  bot: { d: "M7 9.5h10v8.5H7zM12 6v3.5M10 13.5h.5M14 13.5h.5" },
  check: { d: "M5 12.5l4.5 4.5L19 7" },
  chat: { d: "M4 5h16v11H9l-4 3.5V16H4z" },
  close: { d: "M6 6l12 12M18 6L6 18" },
  copy: { d: "M9 9h11v11H9zM15 9V4H4v11h5" },
  dna: { d: "M8 3c0 4.5 8 4.5 8 9s-8 4.5-8 9M16 3c0 4.5-8 4.5-8 9s8 4.5 8 9M9.5 7h5M9.5 17h5" },
  eye: { d: "M2 12c2.5-4 6-6 10-6s7.5 2 10 6c-2.5 4-6 6-10 6s-7.5-2-10-6zM12 15a3 3 0 100-6 3 3 0 000 6z" },
  "eye-off": { d: "M2 12c2.5-4 6-6 10-6s7.5 2 10 6c-2.5 4-6 6-10 6s-7.5-2-10-6zM12 15a3 3 0 100-6 3 3 0 000 6zM4 4l16 16" },
  grid: { d: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
  info: { d: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 16.5v-4.5M12 8h.01" },
  library: { d: "M3 9.5L12 4l9 5.5M5.5 10.5v8M9.5 10.5v8M14.5 10.5v8M18.5 10.5v8M3 20.5h18" },
  lock: { d: "M6 11h12v9H6zM9 11V8a3 3 0 016 0v3" },
  mail: { d: "M3 6h18v12H3zM3.5 7l8.5 6 8.5-6" },
  more: { d: "M5 12h.5M11.75 12h.5M18.5 12h.5", strokeWidth: 3.5 },
  organization: { d: "M3 21h18M5 21V4h9v17M14 10h5v11M8 8h3M8 12h3M8 16h3" },
  "panel-left": { d: "M4 5h16v14H4zM9 5v14" },
  play: { d: "M12 3a9 9 0 100 18 9 9 0 000-18zM10 8.5v7l5.5-3.5-5.5-3.5z" },
  plus: { d: "M12 5v14M5 12h14" },
  teepee: { d: "M12 4.5L19.5 20h-15zM12 4.5l2-2.5M12 4.5l-2-2.5M10.6 20l1.4-5 1.4 5" },
  settings: {
    d: "M12 15a3 3 0 100-6 3 3 0 000 6zM9.7 3.3L14.3 3.3L14.6 6.1L15.8 6.7L18.4 5.6L20.7 9.7L18.5 11.3L18.5 12.7L20.7 14.3L18.4 18.4L15.8 17.3L14.6 17.9L14.3 20.7L9.7 20.7L9.4 17.9L8.2 17.3L5.6 18.4L3.3 14.3L5.5 12.7L5.5 11.3L3.3 9.7L5.6 5.6L8.2 6.7L9.4 6.1z",
  },
  search: { d: "M11 17a6 6 0 100-12 6 6 0 000 12zM15.5 15.5L20 20" },
  "sign-out": { d: "M14 4h5v16h-5M11 8l-4 4 4 4M7 12h9" },
  user: { d: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" },
} as const satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

export const iconNames = Object.keys(ICONS) as IconName[];

export type IconProps = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  duration?: number;
  className?: string;
};

export default function Icon({ name, size = 18, strokeWidth, duration = 280, className }: IconProps) {
  const { d, activeD, rotate, strokeWidth: weight }: IconSpec = ICONS[name];

  const morph = activeD ? ({ "--icon-d-rest": `path("${d}")`, "--icon-d-active": `path("${activeD}")` } as CSSProperties) : undefined;

  const tween = activeD
    ? ({
        d: "var(--icon-d, var(--icon-d-rest))",
        transition: `d var(--icon-duration, ${duration}ms) cubic-bezier(0.22, 1, 0.36, 1)`,
      } as CSSProperties)
    : undefined;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? weight ?? STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={morph}
      aria-hidden="true"
    >
      <path d={d} transform={rotate ? `rotate(${rotate} 12 12)` : undefined} style={tween} />
    </svg>
  );
}
