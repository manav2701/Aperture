import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, TransactionSignature, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

export const ORG_REGISTRY_PROGRAM_ID = new PublicKey("58NW2x3GDGKeFETkGECZSf53Nz8BJxCVSkoBhVCEPchu");

export enum OrgRole {
  Owner = 0,
  CFO = 1,
  TeamLead = 2,
  Developer = 3,
  Auditor = 4,
}

export interface OrgAccountData {
  owner: PublicKey;
  name: string;
  globalDailyCap: BN;
  globalMonthlyCap: BN;
  totalSpentToday: BN;
  totalSpentMonth: BN;
  memberCount: number;
  agentCount: number;
  createdAt: BN;
  bump: number;
}

export interface TeamAccountData {
  org: PublicKey;
  teamLead: PublicKey;
  teamId: number;
  name: string;
  teamDailyCap: BN;
  teamSpentToday: BN;
  agentCount: number;
  bump: number;
}

export interface MemberAccountData {
  org: PublicKey;
  member: PublicKey;
  role: OrgRole;
  joinedAt: BN;
  bump: number;
}

export class OrgRegistryClient {
  public program: Program;
  public provider: AnchorProvider;

  constructor(program: Program) {
    this.program = program;
    this.provider = program.provider as AnchorProvider;
  }

  public static getOrgPDA(owner: PublicKey, programId: PublicKey = ORG_REGISTRY_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("org"), owner.toBuffer()],
      programId
    );
  }

  public static getTeamPDA(orgPDA: PublicKey, teamId: number, programId: PublicKey = ORG_REGISTRY_PROGRAM_ID): [PublicKey, number] {
    const teamIdBuffer = Buffer.alloc(2);
    teamIdBuffer.writeUInt16LE(teamId, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("team"), orgPDA.toBuffer(), teamIdBuffer],
      programId
    );
  }

  public static getMemberPDA(orgPDA: PublicKey, memberWallet: PublicKey, programId: PublicKey = ORG_REGISTRY_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("member"), orgPDA.toBuffer(), memberWallet.toBuffer()],
      programId
    );
  }

  public async createOrg(
    owner: Keypair,
    name: string,
    globalDailyCap: BN,
    globalMonthlyCap: BN
  ): Promise<{ tx: TransactionSignature; orgPDA: PublicKey; ownerMemberPDA: PublicKey }> {
    const [orgPDA] = OrgRegistryClient.getOrgPDA(owner.publicKey, this.program.programId);
    const [ownerMemberPDA] = OrgRegistryClient.getMemberPDA(orgPDA, owner.publicKey, this.program.programId);

    const tx = await this.program.methods
      .createOrg(name, globalDailyCap, globalMonthlyCap)
      .accounts({
        owner: owner.publicKey,
        orgAccount: orgPDA,
        ownerMemberAccount: ownerMemberPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    return { tx, orgPDA, ownerMemberPDA };
  }

  public async createTeam(
    caller: Keypair,
    orgPDA: PublicKey,
    teamId: number,
    name: string,
    teamDailyCap: BN,
    teamLead: PublicKey
  ): Promise<{ tx: TransactionSignature; teamPDA: PublicKey }> {
    const [callerMemberPDA] = OrgRegistryClient.getMemberPDA(orgPDA, caller.publicKey, this.program.programId);
    const [teamPDA] = OrgRegistryClient.getTeamPDA(orgPDA, teamId, this.program.programId);

    const tx = await this.program.methods
      .createTeam(teamId, name, teamDailyCap)
      .accounts({
        caller: caller.publicKey,
        orgAccount: orgPDA,
        callerMemberAccount: callerMemberPDA,
        teamLead: teamLead,
        teamAccount: teamPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([caller])
      .rpc();

    return { tx, teamPDA };
  }

  public async addMember(
    caller: Keypair,
    orgPDA: PublicKey,
    memberWallet: PublicKey,
    role: OrgRole
  ): Promise<{ tx: TransactionSignature; newMemberPDA: PublicKey }> {
    const [callerMemberPDA] = OrgRegistryClient.getMemberPDA(orgPDA, caller.publicKey, this.program.programId);
    const [newMemberPDA] = OrgRegistryClient.getMemberPDA(orgPDA, memberWallet, this.program.programId);

    const tx = await this.program.methods
      .addMember(role)
      .accounts({
        caller: caller.publicKey,
        orgAccount: orgPDA,
        callerMemberAccount: callerMemberPDA,
        memberWallet: memberWallet,
        newMemberAccount: newMemberPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([caller])
      .rpc();

    return { tx, newMemberPDA };
  }

  public async updateMemberRole(
    caller: Keypair,
    orgPDA: PublicKey,
    targetMemberWallet: PublicKey,
    newRole: OrgRole
  ): Promise<TransactionSignature> {
    const [callerMemberPDA] = OrgRegistryClient.getMemberPDA(orgPDA, caller.publicKey, this.program.programId);
    const [targetMemberPDA] = OrgRegistryClient.getMemberPDA(orgPDA, targetMemberWallet, this.program.programId);

    return await this.program.methods
      .updateMemberRole(newRole)
      .accounts({
        caller: caller.publicKey,
        orgAccount: orgPDA,
        callerMemberAccount: callerMemberPDA,
        targetMemberAccount: targetMemberPDA,
      })
      .signers([caller])
      .rpc();
  }

  public async removeMember(
    caller: Keypair,
    orgPDA: PublicKey,
    targetMemberWallet: PublicKey
  ): Promise<TransactionSignature> {
    const [callerMemberPDA] = OrgRegistryClient.getMemberPDA(orgPDA, caller.publicKey, this.program.programId);
    const [targetMemberPDA] = OrgRegistryClient.getMemberPDA(orgPDA, targetMemberWallet, this.program.programId);

    return await this.program.methods
      .removeMember()
      .accounts({
        caller: caller.publicKey,
        orgAccount: orgPDA,
        callerMemberAccount: callerMemberPDA,
        targetMemberAccount: targetMemberPDA,
      })
      .signers([caller])
      .rpc();
  }

  public async getOrgAccount(orgPDA: PublicKey): Promise<OrgAccountData> {
    const acc = await (this.program.account as any).orgAccount.fetch(orgPDA);
    return {
      owner: acc.owner,
      name: acc.name,
      globalDailyCap: acc.globalDailyCap,
      globalMonthlyCap: acc.globalMonthlyCap,
      totalSpentToday: acc.totalSpentToday,
      totalSpentMonth: acc.totalSpentMonth,
      memberCount: acc.memberCount,
      agentCount: acc.agentCount,
      createdAt: acc.createdAt,
      bump: acc.bump,
    };
  }

  public async getTeamAccount(teamPDA: PublicKey): Promise<TeamAccountData> {
    const acc = await (this.program.account as any).teamAccount.fetch(teamPDA);
    return {
      org: acc.org,
      teamLead: acc.teamLead,
      teamId: acc.teamId,
      name: acc.name,
      teamDailyCap: acc.teamDailyCap,
      teamSpentToday: acc.teamSpentToday,
      agentCount: acc.agentCount,
      bump: acc.bump,
    };
  }

  public async getMemberAccount(memberPDA: PublicKey): Promise<MemberAccountData> {
    const acc = await (this.program.account as any).memberAccount.fetch(memberPDA);
    return {
      org: acc.org,
      member: acc.member,
      role: acc.role,
      joinedAt: acc.joinedAt,
      bump: acc.bump,
    };
  }
}
