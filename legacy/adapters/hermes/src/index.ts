export class ApertureHermesPlugin {
  private sessionSpendMap: Map<string, number> = new Map();

  public recordSessionSpend(sessionId: string, amountSol: number): void {
    const current = this.sessionSpendMap.get(sessionId) || 0;
    this.sessionSpendMap.set(sessionId, current + amountSol);
  }

  public getAccumulatedSpend(sessionId: string): number {
    return this.sessionSpendMap.get(sessionId) || 0;
  }

  public getSuggestedVendors(): string[] {
    return [
      "Orca DEX Pool (7fCo...nVPi)",
      "Raydium Vault (JAGd...3amM)",
      "Helium Data API (9qRs...vW1m)",
    ];
  }
}
