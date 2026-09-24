import type { Budget } from '@/lib/api/types';
import { formatAmount, percentUsed } from '@/lib/format';

/** Spend (and open holds) against the limit for the current period. */
export function BudgetMeter({ budget }: { budget: Budget }) {
  const percent = percentUsed(budget);
  const held = !/^0(\.0*)?$/.test(budget.usage.held);
  return (
    <div className="space-y-1">
      <meter
        min={0}
        max={100}
        low={80}
        high={100}
        optimum={0}
        value={Math.min(percent, 100)}
        aria-label={`${budget.name} usage`}
      />
      <p className="font-mono text-xs text-muted-foreground">
        {formatAmount(budget.usage.spent, budget.unit)}
        {held ? ` + ${formatAmount(budget.usage.held, budget.unit)} held` : ''} of{' '}
        {formatAmount(budget.limit, budget.unit)}
        {' · '}
        {percent}%
      </p>
    </div>
  );
}
