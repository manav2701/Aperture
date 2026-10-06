'use client';

import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/cn';

/*
 * The hero: one isometric pillar per team. The solid part is what the team has spent, the dashed
 * column is its budget, and the ring on top is the ceiling. Two teams are at their ceiling.
 *
 * The entrance (pillars rising out of the floor, rings settling, the full ones turning red) is CSS
 * only, so it plays from first paint. After it, a small loop drops requests in: teams with room take
 * them, teams at the ceiling bounce them. Everything is drawn in SVG with theme colors from classes,
 * since the CSP blocks inline styles.
 */

const SCALE = 28;
const ORIGIN = { x: 112, y: 244 };
const VIEW = { width: 640, height: 560 };
const DEPTH_Y = 1.5;
const SIZE = 1;

function iso(x: number, y: number, z: number): [number, number] {
  return [ORIGIN.x + (x - y) * 0.866 * SCALE, ORIGIN.y + (x + y) * 0.5 * SCALE - z * SCALE];
}

function points(corners: [number, number, number][]) {
  return corners
    .map(([x, y, z]) => iso(x, y, z))
    .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
    .join(' ');
}

/** The three visible faces of a box: left (front), right, top. */
function box(x: number, y: number, w: number, d: number, z0: number, z1: number) {
  return {
    left: points([
      [x, y + d, z0],
      [x + w, y + d, z0],
      [x + w, y + d, z1],
      [x, y + d, z1],
    ]),
    right: points([
      [x + w, y, z0],
      [x + w, y + d, z0],
      [x + w, y + d, z1],
      [x + w, y, z1],
    ]),
    top: points([
      [x, y, z1],
      [x + w, y, z1],
      [x + w, y + d, z1],
      [x, y + d, z1],
    ]),
  };
}

interface Team {
  name: string;
  x: number;
  /** Budget and spend, in thousands of dollars; one unit of height is $1k. */
  budget: number;
  spent: number;
  /** Literal class names, so Tailwind sees them. */
  riseDelay: string;
  heatDelay: string;
  labelDelay: string;
}

// Back to front, so nearer pillars draw over farther ones.
const TEAMS: Team[] = [
  {
    name: 'Research Team',
    x: 1,
    budget: 9,
    spent: 5.6,
    riseDelay: '[animation-delay:150ms]',
    heatDelay: '',
    labelDelay: '[animation-delay:1100ms]',
  },
  {
    name: 'Development Team',
    x: 4.2,
    budget: 8,
    spent: 8,
    riseDelay: '[animation-delay:270ms]',
    heatDelay: '[animation-delay:1350ms,1700ms]',
    labelDelay: '[animation-delay:1250ms]',
  },
  {
    name: 'Finance Team',
    x: 7.4,
    budget: 7,
    spent: 3.9,
    riseDelay: '[animation-delay:390ms]',
    heatDelay: '',
    labelDelay: '[animation-delay:1400ms]',
  },
  {
    name: 'Sales Team',
    x: 10.6,
    budget: 6,
    spent: 2.4,
    riseDelay: '[animation-delay:510ms]',
    heatDelay: '',
    labelDelay: '[animation-delay:1550ms]',
  },
  {
    name: 'Marketing Team',
    x: 13.8,
    budget: 5,
    spent: 5,
    riseDelay: '[animation-delay:630ms]',
    heatDelay: '[animation-delay:1700ms,2050ms]',
    labelDelay: '[animation-delay:1700ms]',
  },
];

const FLOOR = { width: 15.8, depth: 4 };

function money(thousands: number) {
  return `$${String(thousands)}k`;
}

const geometry = TEAMS.map((team) => {
  const atCeiling = team.spent >= team.budget;
  const { x } = team;
  const y = DEPTH_Y;
  // Everything above the pillar's two front base edges: the pillar rises out of the floor through this.
  const [leftX, leftY] = iso(x, y + SIZE, 0);
  const [frontX, frontY] = iso(x + SIZE, y + SIZE, 0);
  const [rightX, rightY] = iso(x + SIZE, y, 0);
  const clip = [
    [leftX - 1, -1000],
    [rightX + 1, -1000],
    [rightX + 1, rightY],
    [frontX, frontY],
    [leftX - 1, leftY],
  ]
    .map(([px, py]) => `${(px ?? 0).toFixed(1)},${(py ?? 0).toFixed(1)}`)
    .join(' ');
  const [labelX, labelY] = iso(x + SIZE + 0.6, y - 0.45, team.budget);
  return {
    ...team,
    atCeiling,
    clip,
    ghost: box(x, y, SIZE, SIZE, 0, team.budget),
    fill: box(x, y, SIZE, SIZE, 0, team.spent),
    ring: points([
      [x - 0.45, y - 0.45, team.budget],
      [x + SIZE + 0.45, y - 0.45, team.budget],
      [x + SIZE + 0.45, y + SIZE + 0.45, team.budget],
      [x - 0.45, y + SIZE + 0.45, team.budget],
    ]),
    label: { x: labelX, y: labelY },
    // Where a dropped request starts, lands on the pillar, and meets the ceiling.
    drop: {
      from: iso(x + SIZE / 2, y + SIZE / 2, team.budget + 3),
      top: iso(x + SIZE / 2, y + SIZE / 2, team.spent + 0.2),
      ceiling: iso(x + SIZE / 2, y + SIZE / 2, team.budget + 0.35),
      away: iso(x + SIZE / 2 + 1.6, y + SIZE / 2 - 0.4, team.budget - 1.8),
    },
  };
});

const CUBE = box(-0.22, -0.22, 0.44, 0.44, 0, 0.44);
const CUBE_ORIGIN = iso(0, 0, 0);

/** Requests that drop in after the entrance: [team index, label]. Teams at the ceiling hold them. */
const REQUESTS: [number, string][] = [
  [2, '+$0.42'],
  [0, '+$1.10'],
  [1, 'held · $12.00'],
  [3, '+$38.00'],
  [2, '+$0.08'],
  [4, 'held · $180.00'],
  [0, '+$0.31'],
  [3, '+$4.90'],
];

/** A card per team at its ceiling, joined to its label by a dashed leader. */
const CALLOUTS = [
  { team: 'Development Team', x: 410, y: 24, leader: '372,108 410,54', delay: '[animation-delay:1900ms]' },
  { team: 'Marketing Team', x: 462, y: 378, leader: '520,350 540,378', delay: '[animation-delay:2250ms]' },
];

export function BudgetSkyline({ className }: { className?: string }) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const cubeRef = useRef<SVGGElement>(null);
  const tickRef = useRef<SVGTextElement>(null);
  const flashRefs = useRef<(SVGPolygonElement | null)[]>([]);

  useEffect(() => {
    const svg = svgRef.current;
    const cube = cubeRef.current;
    const tick = tickRef.current;
    if (svg === null || cube === null || tick === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let step = 0;
    let timer = 0;
    let visible = true;

    const offset = (point: readonly [number, number]) =>
      `translate(${(point[0] - CUBE_ORIGIN[0]).toFixed(1)}px, ${(point[1] - CUBE_ORIGIN[1]).toFixed(1)}px)`;

    function drop() {
      if (!visible || document.hidden || cube === null || tick === null) return;
      const [index, text] = REQUESTS[step % REQUESTS.length] ?? [0, ''];
      step += 1;
      const team = geometry[index];
      if (team === undefined) return;

      cube.classList.toggle('sky-cube-held', team.atCeiling);
      const fall = { duration: 650, easing: 'cubic-bezier(0.55, 0, 0.8, 0.4)', fill: 'forwards' as const };
      if (team.atCeiling) {
        cube.animate(
          [
            { transform: offset(team.drop.from), opacity: 0 },
            { transform: offset(team.drop.ceiling), opacity: 1, offset: 0.55 },
            { transform: offset(team.drop.ceiling), opacity: 1, offset: 0.65 },
            { transform: offset(team.drop.away), opacity: 0 },
          ],
          { ...fall, duration: 1300, easing: 'ease-in-out' },
        );
      } else {
        cube.animate(
          [
            { transform: offset(team.drop.from), opacity: 0 },
            { transform: offset(team.drop.top), opacity: 1, offset: 0.9 },
            { transform: offset(team.drop.top), opacity: 0 },
          ],
          fall,
        );
        flashRefs.current[index]?.animate([{ opacity: 0 }, { opacity: 0.75 }, { opacity: 0 }], {
          duration: 500,
          delay: 600,
        });
      }

      tick.textContent = text;
      tick.classList.toggle('sky-tick-held', team.atCeiling);
      tick.setAttribute('x', team.label.x.toFixed(1));
      tick.setAttribute('y', (team.label.y - 26).toFixed(1));
      tick.animate(
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'translateY(0)', offset: 0.2 },
          { opacity: 1, transform: 'translateY(-4px)', offset: 0.75 },
          { opacity: 0, transform: 'translateY(-10px)' },
        ],
        { duration: 1500, delay: team.atCeiling ? 700 : 600, fill: 'both' },
      );
    }

    // Start once the entrance has played.
    const start = window.setTimeout(() => {
      drop();
      timer = window.setInterval(drop, 1700);
    }, 2600);

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
    });
    observer.observe(svg);

    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${String(VIEW.width)} ${String(VIEW.height)}`}
      className={cn('h-auto w-full overflow-visible', className)}
      role="img"
      aria-label="Team budgets as pillars. Development Team and Marketing Team have reached their ceilings, so their next requests are held."
    >
      <defs>
        {geometry.map((team, i) => (
          <clipPath key={team.name} id={`${id}-clip-${String(i)}`}>
            <polygon points={team.clip} />
          </clipPath>
        ))}
      </defs>

      {/* Floor */}
      <g className="sky-fade">
        {Array.from({ length: Math.floor(FLOOR.width) + 1 }, (_, i) => (
          <polyline
            key={`x${String(i)}`}
            points={points([
              [i, 0, 0],
              [i, FLOOR.depth, 0],
            ])}
            className="fill-none stroke-border/60"
          />
        ))}
        {Array.from({ length: FLOOR.depth + 1 }, (_, j) => (
          <polyline
            key={`y${String(j)}`}
            points={points([
              [0, j, 0],
              [FLOOR.width, j, 0],
            ])}
            className="fill-none stroke-border/60"
          />
        ))}
      </g>

      {geometry.map((team, i) => (
        <g key={team.name}>
          {/* Budget: a dashed glass column up to the ceiling. */}
          <g className={cn('sky-fade', team.riseDelay)}>
            <polygon
              points={team.ghost.left}
              className="fill-foreground/2 stroke-muted-foreground/50 [stroke-dasharray:2_4]"
            />
            <polygon
              points={team.ghost.right}
              className="fill-foreground/4 stroke-muted-foreground/50 [stroke-dasharray:2_4]"
            />
          </g>

          {/* Spend: rises out of the floor; full teams turn red when they reach the ring. */}
          <g clipPath={`url(#${id}-clip-${String(i)})`}>
            <g className={cn('sky-rise', team.riseDelay)}>
              <polygon
                points={team.fill.left}
                className={cn(team.atCeiling ? 'sky-heat fill-danger' : 'fill-accent', team.heatDelay)}
              />
              <polygon points={team.fill.left} className="fill-black/25" />
              <polygon
                points={team.fill.right}
                className={cn(team.atCeiling ? 'sky-heat fill-danger' : 'fill-accent', team.heatDelay)}
              />
              <polygon points={team.fill.right} className="fill-black/45" />
              <polygon
                points={team.fill.top}
                className={cn(team.atCeiling ? 'sky-heat fill-danger' : 'fill-accent', team.heatDelay)}
              />
              <polygon
                ref={(node) => {
                  flashRefs.current[i] = node;
                }}
                points={team.fill.top}
                className="fill-white opacity-0"
              />
            </g>
          </g>

          {/* The ceiling. */}
          <g className={cn('sky-ring-in', team.riseDelay)}>
            <polygon
              points={team.ring}
              className={cn(
                'fill-none stroke-[1.5]',
                team.atCeiling ? 'sky-ring-hot stroke-danger' : 'stroke-foreground',
                team.heatDelay,
              )}
            />
          </g>
        </g>
      ))}

      {/* Labels */}
      {geometry.map((team) => (
        <g key={team.name} className={cn('sky-pop', team.labelDelay)}>
          <text
            x={team.label.x}
            y={team.label.y}
            className={cn('font-sans text-[12px] font-semibold', team.atCeiling ? 'fill-danger' : 'fill-foreground')}
          >
            {team.name}
          </text>
          <text
            x={team.label.x}
            y={team.label.y + 14}
            className={cn('font-mono text-[10px]', team.atCeiling ? 'fill-danger' : 'fill-muted-foreground')}
          >
            {team.atCeiling
              ? `${money(team.spent)} of ${money(team.budget)} · at ceiling`
              : `${money(team.spent)} of ${money(team.budget)}`}
          </text>
        </g>
      ))}

      {/* Callouts for the two teams at their ceiling. */}
      {CALLOUTS.map((callout) => (
        <g key={callout.team} className={cn('sky-pop', callout.delay)}>
          <polyline points={callout.leader} className="fill-none stroke-danger/60 [stroke-dasharray:3_3]" />
          <rect
            x={callout.x}
            y={callout.y}
            width={170}
            height={60}
            className="fill-background stroke-danger stroke-1"
          />
          <text x={callout.x + 12} y={callout.y + 18} className="fill-danger font-mono text-[9px] tracking-[0.16em]">
            CEILING REACHED
          </text>
          <text x={callout.x + 12} y={callout.y + 34} className="fill-foreground font-sans text-[12px] font-semibold">
            {callout.team}
          </text>
          <text x={callout.x + 12} y={callout.y + 49} className="fill-muted-foreground font-mono text-[10px]">
            next request is held
          </text>
        </g>
      ))}

      {/* A request on its way in (moved by the loop above). */}
      <g ref={cubeRef} className="sky-cube opacity-0">
        <polygon points={CUBE.left} className="fill-current" />
        <polygon points={CUBE.left} className="fill-black/25" />
        <polygon points={CUBE.right} className="fill-current" />
        <polygon points={CUBE.right} className="fill-black/45" />
        <polygon points={CUBE.top} className="fill-current" />
      </g>
      <text ref={tickRef} className="sky-tick pointer-events-none font-mono text-[11px] font-medium opacity-0" />
    </svg>
  );
}
