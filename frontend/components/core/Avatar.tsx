"use client";

import { useState, type CSSProperties } from "react";

export type AvatarProps = {
  /** Where the picture lives. Empty when there is none, which is the ordinary
   * case for an account made with an email and a password. */
  src?: string;
  /** Drawn when there is no picture, or when the one there is will not load. */
  initials: string;
  /** Edge length in pixels. The text scales with it so one component covers a
   * row in a menu and a header on a settings page. */
  size?: number;
  className?: string;
  /** The ground behind the initials, where the caller has a colour of its own to give it —
   * a broodmother profile is known by one everywhere else in the app. */
  style?: CSSProperties;
};

const base = "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-active text-charcoal select-none";

export default function Avatar({ src, initials, size = 28, className, style }: AvatarProps) {
  // A picture the provider hosts can 404 — an account can be deleted upstream,
  // and a CDN URL outlives the record that named it. Falling back on error is
  // what stops that being a broken-image icon in the corner of every page.
  const [broken, setBroken] = useState(false);
  const showing = src && !broken;

  return (
    <span className={`${base} ${className ?? ""}`} style={{ width: size, height: size, ...style }}>
      {showing ? (
        // Not next/image: the source is either an external CDN or a route that
        // streams bytes, and neither wants a build-time optimizer in front of
        // it. The element is fixed-size and square, so there is no layout shift
        // to protect against either.
        <img src={src} alt="" width={size} height={size} className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.4) }} className="font-semibold leading-none">
          {initials}
        </span>
      )}
    </span>
  );
}
