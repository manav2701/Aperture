'use client';

interface BudgetForecastProps {
  dailySpentSol?: number;
  dailyCapSol?: number;
  monthlySpentSol?: number;
  monthlyCapSol?: number;
}

export default function BudgetForecastWidget({
  dailySpentSol = 1.25,
  dailyCapSol = 20.0,
  monthlySpentSol = 18.5,
  monthlyCapSol = 300.0,
}: BudgetForecastProps) {
  const hoursPassedToday = Math.max(new Date().getHours(), 1);
  const hourlyRateSol = dailySpentSol / hoursPassedToday;
  
  const hoursUntilDailyExhaustion =
    hourlyRateSol > 0 ? (dailyCapSol - dailySpentSol) / hourlyRateSol : 24;

  const daysUntilMonthlyExhaustion =
    dailySpentSol > 0 ? (monthlyCapSol - monthlySpentSol) / dailySpentSol : 30;

  return (
    <div className="bg-background border-2 border-border p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-3 border-b-2 border-border pb-4">
        <div className="w-3 h-3 bg-accent animate-pulse" />
        <h3 className="font-mono text-lg font-bold text-foreground uppercase tracking-tighter">
          [📊] SPEND FORECAST &amp; EXHAUSTION ENGINE
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="kinetic-card p-5">
          <span className="text-[10px] font-mono text-mutedForeground uppercase tracking-widest block mb-1">
            SPEND VELOCITY
          </span>
          <div className="text-2xl font-mono font-bold text-accent tracking-tighter">
            {hourlyRateSol.toFixed(2)} SOL / hr
          </div>
          <span className="text-[10px] font-mono text-mutedForeground block mt-1 uppercase">
            PROJECTED 24H: {(hourlyRateSol * 24).toFixed(2)} SOL
          </span>
        </div>

        <div className="kinetic-card p-5">
          <span className="text-[10px] font-mono text-mutedForeground uppercase tracking-widest block mb-1">
            EST. LIMIT EXHAUSTION
          </span>
          <div className="text-2xl font-mono font-bold text-foreground tracking-tighter">
            {hoursUntilDailyExhaustion > 24
              ? 'SUSTAINABLE'
              : `${hoursUntilDailyExhaustion.toFixed(1)} HRS LEFT`}
          </div>
          <span className="text-[10px] font-mono text-mutedForeground block mt-1 uppercase">
            MONTHLY CAP EXHAUSTION: ~{daysUntilMonthlyExhaustion.toFixed(0)} DAYS
          </span>
        </div>
      </div>
    </div>
  );
}
