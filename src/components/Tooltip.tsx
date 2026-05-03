'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Tooltip text. */
  text?: string;
  /** Optional rich content. Wins over `text` when both are set. */
  node?: ReactNode;
  /** Where the tooltip appears relative to the trigger. */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Trigger content. */
  children: ReactNode;
  /** Disable the tooltip without changing markup. */
  disabled?: boolean;
  /** Extra classes for the trigger wrapper. */
  className?: string;
}

interface Coords {
  left: number;
  top: number;
  /** Final resolved position after viewport-edge clamp. */
  side: 'top' | 'bottom' | 'left' | 'right';
}

const GAP = 8;

/**
 * Portal-based tooltip. Replaces the browser-default `title=` cream/yellow
 * popup with a styled bubble that respects the app's design tokens. Uses
 * `createPortal` to escape ancestor `overflow:hidden` containers (track
 * rows, list cards, etc.) — the previous CSS-only version got clipped.
 *
 * Behaviour:
 *   - shows on mouseenter / focus, hides on mouseleave / blur
 *   - position is computed against viewport edges; if the configured side
 *     would go off-screen, we flip to the opposite side
 *   - keyboard users: trigger should be focusable (button, a, input)
 */
export default function Tooltip({
  text,
  node,
  position = 'bottom',
  children,
  disabled = false,
  className = '',
}: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);

  // Resolved tooltip content; bail out early if nothing to show.
  const content = node ?? text ?? null;
  const isActive = open && !disabled && content != null;

  useEffect(() => {
    if (!isActive) return;
    function compute() {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;
      const t = trigger.getBoundingClientRect();
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Try the requested side first; flip if it would clip.
      let side: 'top' | 'bottom' | 'left' | 'right' = position;
      if (side === 'bottom' && t.bottom + GAP + th > vh) side = 'top';
      else if (side === 'top' && t.top - GAP - th < 0) side = 'bottom';
      else if (side === 'right' && t.right + GAP + tw > vw) side = 'left';
      else if (side === 'left' && t.left - GAP - tw < 0) side = 'right';

      let left = 0;
      let top = 0;
      if (side === 'bottom' || side === 'top') {
        left = t.left + t.width / 2 - tw / 2;
        top = side === 'bottom' ? t.bottom + GAP : t.top - th - GAP;
      } else {
        top = t.top + t.height / 2 - th / 2;
        left = side === 'right' ? t.right + GAP : t.left - tw - GAP;
      }

      // Clamp to viewport so the bubble can't slide off the edge.
      left = Math.max(GAP, Math.min(left, vw - tw - GAP));
      top = Math.max(GAP, Math.min(top, vh - th - GAP));
      setCoords({ left, top, side });
    }
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [isActive, position]);

  if (!content) return <>{children}</>;

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex ${className}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {isActive &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            className="pointer-events-none fixed z-[60] max-w-xs whitespace-normal rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-xs text-fg-primary shadow-lg"
            style={{
              left: coords?.left ?? 0,
              top: coords?.top ?? 0,
              opacity: coords ? 1 : 0,
              transition: 'opacity 120ms ease-out',
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
