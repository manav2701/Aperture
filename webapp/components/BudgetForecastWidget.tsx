'use client';

import { HiTrendingUp, HiClock, HiExclamation } from 'react-icons/hi';

interface BudgetForecastProps {
  dailySpentSol: number;
  dailyCapSol: number;
  monthlySpentSol: number;
  monthlyCapSol: number;
}

export default function BudgetForecastWidget({
  dailySpentSol,
  dailyCapSol,
  monthlySpentSol,
  monthlyCapSol,
}: BudgetForecastProps) {
  // Simple rolling average projections
  const hoursPassedToday = Math.max(new Date().getHours(), 1);
  const hourlyRateSol = dailySpentSol / hoursPassedToday;
  
  const hoursUntilDailyExhaustion =
    hourlyRateSol > 0 ? (dailyCapSol - dailySpentSol) / hourlyRateSol : 24;

  const daysUntilMonthlyExhaustion =
    dailySpentSol > 0 ? (monthlyCapSol - monthlySpentSol) / dailySpentSol : 30;

  return (
    <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-6 backdrop-blur-xl space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <HiTrendingUp className="w-5 h-5 text-cyan-400" />
        <h3 className="font-mono text-sm font-bold text-cyan-400 uppercase tracking-wider">
          &gt; AI Agent Spend Forecast & Exhaustion Engine
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1">
            Current Spend Velocity
          </span>
          <span className="text-xl font-mono font-bold text-cyan-400">
            {hourlyRateSol.toFixed(2)} SOL / hour
          </span>
          <span className="text-[10px] font-mono text-slate-500 block mt-1">
            Projected 24h spend: {(hourlyRateSol * 24).toFixed(2)} SOL
          </span>
        </div>

        <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1">
            Projected Limit Exhaustion
          </span>
          <span className="text-xl font-mono font-bold text-purple-400">
            {hoursUntilDailyExhaustion > 24
              ? 'Sustainable'
              : `${hoursUntilDailyExhaustion.toFixed(1)} hours left`}
          </span>
          <span className="text-[10px] font-mono text-slate-500 block mt-1">
            Monthly cap exhaustion in ~{daysUntilMonthlyExhaustion.toFixed(0)} days
          </span>
        </div>
      </div>
    </div>
  );
}
