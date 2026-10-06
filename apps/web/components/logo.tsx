import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * The Signal mark: an eye drawn with meter bars, the pupil in the accent color. Bars take the
 * current text color, so the mark follows the theme. (app/icon.svg is the five-bar cut for tabs.)
 */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('shrink-0', className)}>
      <g className="fill-current">
        <rect x="22" y="15" width="20" height="4" />
        <rect x="11" y="22" width="42" height="4" />
        <rect x="4" y="30" width="20" height="4" />
        <rect x="40" y="30" width="20" height="4" />
        <rect x="11" y="38" width="42" height="4" />
        <rect x="22" y="45" width="20" height="4" />
      </g>
      <rect x="27" y="27" width="10" height="10" className="fill-accent" />
    </svg>
  );
}

/** Mark plus wordmark, linking home (or wherever `href` says). */
export function Logo({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label="Aperture home"
      className={cn('inline-flex items-center gap-2 text-foreground', className)}
    >
      <LogoMark className="size-7" />
      <span className="text-lg font-semibold tracking-tight">aperture</span>
    </Link>
  );
}
