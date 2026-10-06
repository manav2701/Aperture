'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';

const MAX_TILT_DEG = 2.5;

/**
 * Wraps the feature cards. As the pointer moves, the card under it gets a spotlight and a slight
 * tilt (custom properties read by `.spotlight` in globals.css; set through CSSOM, which the CSP
 * allows).
 */
export function SpotlightGrid({ className, children }: { className?: string; children: ReactNode }) {
  const active = useRef<HTMLElement | null>(null);

  function reset(card: HTMLElement | null) {
    card?.style.setProperty('--rx', '0deg');
    card?.style.setProperty('--ry', '0deg');
  }

  function onMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    const card = (event.target as Element).closest<HTMLElement>('.spotlight');
    if (card !== active.current) {
      reset(active.current);
      active.current = card;
    }
    if (card === null) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    card.style.setProperty('--rx', `${((0.5 - y) * MAX_TILT_DEG).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${((x - 0.5) * MAX_TILT_DEG).toFixed(2)}deg`);
  }

  return (
    <div
      className={className}
      onPointerMove={onMove}
      onPointerLeave={() => {
        reset(active.current);
        active.current = null;
      }}
    >
      {children}
    </div>
  );
}
