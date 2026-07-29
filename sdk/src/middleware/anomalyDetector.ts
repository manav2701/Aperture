import BN from "bn.js";

export interface SpendRecord {
  timestamp: number;
  amountSol: number;
}

export class SpendAnomalyDetector {
  private history: SpendRecord[] = [];
  private multiplierThreshold: number;

  constructor(multiplierThreshold: number = 3.0) {
    this.multiplierThreshold = multiplierThreshold;
  }

  public recordTransaction(amountSol: number, timestamp: number = Date.now()): void {
    this.history.push({ timestamp, amountSol });
    // Keep last 24 hours of history
    const oneDayAgo = Date.now() - 86400 * 1000;
    this.history = this.history.filter((rec) => rec.timestamp >= oneDayAgo);
  }

  public isAnomaly(proposedAmountSol: number): boolean {
    if (this.history.length < 3) return false; // Need minimum baseline

    const totalPastSol = this.history.reduce((sum, rec) => sum + rec.amountSol, 0);
    const avgSol = totalPastSol / this.history.length;

    return proposedAmountSol > avgSol * this.multiplierThreshold;
  }
}
