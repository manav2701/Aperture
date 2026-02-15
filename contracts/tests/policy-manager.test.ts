import { Cl } from "@stacks/transactions";
import { describe, expect, it, beforeEach } from "vitest";
import { simnet } from '@hirosystems/clarinet-sdk';

// Test accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const agent1 = accounts.get("wallet_1")!;
const agent2 = accounts.get("wallet_2")!;
const policyOwner = accounts.get("wallet_3")!;

// Constants matching contract
const ASSET_STX = Cl.uint(1);
const ASSET_SBTC = Cl.uint(2);

describe("Policy Manager Contract Tests", () => {
  
  describe("Policy Creation", () => {
    
    it("allows contract owner to create policy for any agent", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        deployer
      );
      
      expect(result.result).toBeOk();
    });
    
    it("allows agent to create policy for themselves", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        agent1
      );
      
      expect(result.result).toBeOk();
    });
    
    it("prevents unauthorized users from creating policy", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        agent2
      );
      
      expect(result.result).toBeErr(Cl.uint(100));
    });
    
    it("stores policy correctly", () => {
      simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        deployer
      );
      
      const policy = simnet.callReadOnlyFn(
        "policy-manager",
        "get-policy",
        [Cl.principal(agent1)],
        deployer
      );
      
      expect(policy.result).toBeSome();
      expect(policy.result.value).toBeTruthy();
    });
    
  });
  
  describe("Policy Updates", () => {
    
    beforeEach(() => {
      simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        policyOwner
      );
    });
    
    it("allows policy owner to update policy", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "update-policy",
        [
          Cl.principal(agent1),
          Cl.uint(2000000),
          Cl.uint(200000000),
          Cl.uint(200000),
          Cl.uint(20000000),
        ],
        policyOwner
      );
      
      expect(result.result).toBeOk();
    });
    
    it("prevents non-owner from updating policy", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "update-policy",
        [
          Cl.principal(agent1),
          Cl.uint(2000000),
          Cl.uint(200000000),
          Cl.uint(200000),
          Cl.uint(20000000),
        ],
        agent2
      );
      
      expect(result.result).toBeErr(Cl.uint(100));
    });
    
  });
  
  describe("Service Management", () => {
    
    beforeEach(() => {
      simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        policyOwner
      );
    });
    
    it("allows owner to approve services", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "approve-service",
        [
          Cl.principal(agent1),
          Cl.stringAscii("https://api.weather.com")
        ],
        policyOwner
      );
      
      expect(result.result).toBeOk();
    });
    
    it("allows owner to revoke services", () => {
      simnet.callPublicFn(
        "policy-manager",
        "approve-service",
        [
          Cl.principal(agent1),
          Cl.stringAscii("https://api.weather.com")
        ],
        policyOwner
      );
      
      const result = simnet.callPublicFn(
        "policy-manager",
        "revoke-service",
        [
          Cl.principal(agent1),
          Cl.stringAscii("https://api.weather.com")
        ],
        policyOwner
      );
      
      expect(result.result).toBeOk();
    });
    
  });
  
  describe("Payment Validation", () => {
    
    beforeEach(() => {
      simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        policyOwner
      );
      
      simnet.callPublicFn(
        "policy-manager",
        "approve-service",
        [
          Cl.principal(agent1),
          Cl.stringAscii("https://api.weather.com")
        ],
        policyOwner
      );
      
      simnet.callPublicFn(
        "policy-manager",
        "approve-facilitator",
        [
          Cl.principal(agent1),
          Cl.principal(deployer)
        ],
        policyOwner
      );
    });
    
    it("allows payment within limits", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "check-payment-allowed",
        [
          Cl.principal(agent1),
          Cl.uint(50000),
          ASSET_STX,
          Cl.stringAscii("https://api.weather.com"),
          Cl.principal(deployer)
        ],
        deployer
      );
      
      expect(result.result).toBeOk();
    });
    
    it("blocks payment exceeding per-tx limit", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "check-payment-allowed",
        [
          Cl.principal(agent1),
          Cl.uint(200000),
          ASSET_STX,
          Cl.stringAscii("https://api.weather.com"),
          Cl.principal(deployer)
        ],
        deployer
      );
      
      expect(result.result).toBeErr(Cl.uint(103));
    });
    
    it("blocks payment exceeding daily limit", () => {
      simnet.callPublicFn(
        "policy-manager",
        "record-payment",
        [
          Cl.principal(agent1),
          Cl.uint(950000),
          ASSET_STX,
          Cl.stringAscii("https://api.weather.com"),
          Cl.none()
        ],
        deployer
      );
      
      const result = simnet.callPublicFn(
        "policy-manager",
        "check-payment-allowed",
        [
          Cl.principal(agent1),
          Cl.uint(100000),
          ASSET_STX,
          Cl.stringAscii("https://api.weather.com"),
          Cl.principal(deployer)
        ],
        deployer
      );
      
      expect(result.result).toBeErr(Cl.uint(102));
    });
    
    it("blocks payment to unapproved service", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "check-payment-allowed",
        [
          Cl.principal(agent1),
          Cl.uint(50000),
          ASSET_STX,
          Cl.stringAscii("https://api.malicious.com"),
          Cl.principal(deployer)
        ],
        deployer
      );
      
      expect(result.result).toBeErr(Cl.uint(104));
    });
    
    it("blocks payment via unapproved facilitator", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "check-payment-allowed",
        [
          Cl.principal(agent1),
          Cl.uint(50000),
          ASSET_STX,
          Cl.stringAscii("https://api.weather.com"),
          Cl.principal(agent2)
        ],
        deployer
      );
      
      expect(result.result).toBeErr(Cl.uint(108));
    });
    
  });
  
  describe("Payment Recording", () => {
    
    beforeEach(() => {
      simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        policyOwner
      );
    });
    
    it("records payment and increments counter", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "record-payment",
        [
          Cl.principal(agent1),
          Cl.uint(50000),
          ASSET_STX,
          Cl.stringAscii("https://api.weather.com"),
          Cl.none()
        ],
        deployer
      );
      
      expect(result.result).toBeOk();
    });
    
    it("updates daily spending correctly", () => {
      simnet.callPublicFn(
        "policy-manager",
        "record-payment",
        [
          Cl.principal(agent1),
          Cl.uint(50000),
          ASSET_STX,
          Cl.stringAscii("https://api.weather.com"),
          Cl.none()
        ],
        deployer
      );
      
      const spending = simnet.callReadOnlyFn(
        "policy-manager",
        "get-daily-spending",
        [Cl.principal(agent1)],
        deployer
      );
      
      expect(spending.result).toBeSome();
    });
    
  });
  
  describe("Emergency Controls", () => {
    
    beforeEach(() => {
      simnet.callPublicFn(
        "policy-manager",
        "create-policy",
        [
          Cl.principal(agent1),
          Cl.uint(1000000),
          Cl.uint(100000000),
          Cl.uint(100000),
          Cl.uint(10000000),
        ],
        policyOwner
      );
      
      simnet.callPublicFn(
        "policy-manager",
        "approve-service",
        [Cl.principal(agent1), Cl.stringAscii("https://api.weather.com")],
        policyOwner
      );
      
      simnet.callPublicFn(
        "policy-manager",
        "approve-facilitator",
        [Cl.principal(agent1), Cl.principal(deployer)],
        policyOwner
      );
    });
    
    it("allows owner to pause agent", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "pause-agent",
        [Cl.principal(agent1)],
        policyOwner
      );
      
      expect(result.result).toBeOk();
    });
    
    it("blocks payments when agent is paused", () => {
      simnet.callPublicFn(
        "policy-manager",
        "pause-agent",
        [Cl.principal(agent1)],
        policyOwner
      );
      
      const result = simnet.callPublicFn(
        "policy-manager",
        "check-payment-allowed",
        [
          Cl.principal(agent1),
          Cl.uint(50000),
          ASSET_STX,
          Cl.stringAscii("https://api.weather.com"),
          Cl.principal(deployer)
        ],
        deployer
      );
      
      expect(result.result).toBeErr(Cl.uint(105));
    });
    
    it("allows owner to unpause agent", () => {
      simnet.callPublicFn(
        "policy-manager",
        "pause-agent",
        [Cl.principal(agent1)],
        policyOwner
      );
      
      const result = simnet.callPublicFn(
        "policy-manager",
        "unpause-agent",
        [Cl.principal(agent1)],
        policyOwner
      );
      
      expect(result.result).toBeOk();
    });
    
    it("permanently revokes agent access", () => {
      const result = simnet.callPublicFn(
        "policy-manager",
        "revoke-agent",
        [Cl.principal(agent1)],
        policyOwner
      );
      
      expect(result.result).toBeOk();
    });
    
  });
  
});