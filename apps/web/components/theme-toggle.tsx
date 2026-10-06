'use client';

import { HalfMoon, SunLight } from 'iconoir-react';
import type { MouseEvent } from 'react';
import { cn } from '@/lib/cn';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Read by the root layout on the next request, so the page renders in this theme with no flash.
  document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Switches between light and dark. Where the browser has View Transitions, the new theme spreads
 * out from the button as a circle; elsewhere colors cross-fade. Reduced motion gets an instant swap.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle(event: MouseEvent<HTMLButtonElement>) {
    const root = document.documentElement;
    const next: Theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      applyTheme(next);
      return;
    }
    if (typeof document.startViewTransition !== 'function') {
      root.classList.add('theme-fade');
      applyTheme(next);
      window.setTimeout(() => {
        root.classList.remove('theme-fade');
      }, 320);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(() => {
      applyTheme(next);
    });
    const at = `at ${x.toFixed(1)}px ${y.toFixed(1)}px`;
    void transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px ${at})`, `circle(${radius.toFixed(1)}px ${at})`] },
        { duration: 650, easing: 'cubic-bezier(0.7, 0, 0.25, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark theme"
      className={cn(
        'relative inline-flex size-9 items-center justify-center border border-border text-foreground transition-colors hover:bg-muted',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight',
        className,
      )}
    >
      <SunLight
        aria-hidden="true"
        className="absolute size-[18px] transition-all duration-500 dark:rotate-90 dark:scale-0 dark:opacity-0"
      />
      <HalfMoon
        aria-hidden="true"
        className="absolute size-[18px] transition-all duration-500 light:-rotate-90 light:scale-0 light:opacity-0"
      />
    </button>
  );
}
