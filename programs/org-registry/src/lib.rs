use anchor_lang::prelude::*;

declare_id!("58NW2x3GDGKeFETkGECZSf53Nz8BJxCVSkoBhVCEPchu");

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrgRole {
    Owner = 0,
    CFO = 1,
    TeamLead = 2,
    Developer = 3,
    Auditor = 4,
}

impl OrgRole {
    pub fn from_u8(val: u8) -> Result<Self> {
        match val {
            0 => Ok(OrgRole::Owner),
            1 => Ok(OrgRole::CFO),
            2 => Ok(OrgRole::TeamLead),
            3 => Ok(OrgRole::Developer),
            4 => Ok(OrgRole::Auditor),
            _ => Err(error!(ErrorCode::InvalidRole)),
        }
    }
}

#[program]
pub mod org_registry {
    use super::*;

    pub fn create_org(
        ctx: Context<CreateOrg>,
        name: String,
        global_daily_cap: u64,
        global_monthly_cap: u64,
    ) -> Result<()> {
        require!(name.len() <= 64, ErrorCode::NameTooLong);

        let org = &mut ctx.accounts.org_account;
        let clock = Clock::get()?;

        org.owner = ctx.accounts.owner.key();
        org.name = name;
        org.global_daily_cap = global_daily_cap;
        org.global_monthly_cap = global_monthly_cap;
        org.total_spent_today = 0;
        org.total_spent_month = 0;
        org.member_count = 1;
        org.agent_count = 0;
        org.created_at = clock.unix_timestamp;
        org.bump = ctx.bumps.org_account;

        // Initialize Owner MemberAccount
        let owner_member = &mut ctx.accounts.owner_member_account;
        owner_member.org = org.key();
        owner_member.member = ctx.accounts.owner.key();
        owner_member.role = OrgRole::Owner as u8;
        owner_member.joined_at = clock.unix_timestamp;
        owner_member.bump = ctx.bumps.owner_member_account;

        msg!("Org created: {} (Owner: {:?})", org.name, org.owner);
        Ok(())
    }

    pub fn create_team(
        ctx: Context<CreateTeam>,
        team_id: u16,
        name: String,
        team_daily_cap: u64,
    ) -> Result<()> {
        require!(name.len() <= 64, ErrorCode::NameTooLong);
        require!(
            ctx.accounts.caller_member_account.role == OrgRole::Owner as u8
                || ctx.accounts.caller_member_account.role == OrgRole::CFO as u8,
            ErrorCode::UnauthorizedRole
        );

        let team = &mut ctx.accounts.team_account;
        team.org = ctx.accounts.org_account.key();
        team.team_lead = ctx.accounts.team_lead.key();
        team.team_id = team_id;
        team.name = name;
        team.team_daily_cap = team_daily_cap;
        team.team_spent_today = 0;
        team.agent_count = 0;
        team.bump = ctx.bumps.team_account;

        msg!("Team created: {} (ID: {})", team.name, team_id);
        Ok(())
    }

    pub fn add_member(
        ctx: Context<AddMember>,
        role: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.caller_member_account.role == OrgRole::Owner as u8
                || ctx.accounts.caller_member_account.role == OrgRole::CFO as u8,
            ErrorCode::UnauthorizedRole
        );
        OrgRole::from_u8(role)?;

        let clock = Clock::get()?;
        let member_acc = &mut ctx.accounts.new_member_account;
        member_acc.org = ctx.accounts.org_account.key();
        member_acc.member = ctx.accounts.member_wallet.key();
        member_acc.role = role;
        member_acc.joined_at = clock.unix_timestamp;
        member_acc.bump = ctx.bumps.new_member_account;

        let org = &mut ctx.accounts.org_account;
        org.member_count += 1;

        msg!("Member added: {:?} with role {}", member_acc.member, role);
        Ok(())
    }

    pub fn update_member_role(
        ctx: Context<UpdateMemberRole>,
        new_role: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.caller_member_account.role == OrgRole::Owner as u8
                || ctx.accounts.caller_member_account.role == OrgRole::CFO as u8,
            ErrorCode::UnauthorizedRole
        );
        OrgRole::from_u8(new_role)?;

        let target_member = &mut ctx.accounts.target_member_account;
        target_member.role = new_role;

        msg!("Member role updated for {:?} -> {}", target_member.member, new_role);
        Ok(())
    }

    pub fn remove_member(ctx: Context<RemoveMember>) -> Result<()> {
        require!(
            ctx.accounts.caller_member_account.role == OrgRole::Owner as u8
                || ctx.accounts.caller_member_account.role == OrgRole::CFO as u8,
            ErrorCode::UnauthorizedRole
        );

        let org = &mut ctx.accounts.org_account;
        if org.member_count > 0 {
            org.member_count -= 1;
        }

        msg!("Member account removed");
        Ok(())
    }

    pub fn update_org_caps(
        ctx: Context<UpdateOrgCaps>,
        global_daily_cap: u64,
        global_monthly_cap: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.caller_member_account.role == OrgRole::Owner as u8
                || ctx.accounts.caller_member_account.role == OrgRole::CFO as u8,
            ErrorCode::UnauthorizedRole
        );

        let org = &mut ctx.accounts.org_account;
        org.global_daily_cap = global_daily_cap;
        org.global_monthly_cap = global_monthly_cap;

        msg!("Org caps updated: Daily={}, Monthly={}", global_daily_cap, global_monthly_cap);
        Ok(())
    }

    pub fn transfer_org_ownership(
        ctx: Context<TransferOrgOwnership>,
        new_owner: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.owner.key() == ctx.accounts.org_account.owner,
            ErrorCode::UnauthorizedRole
        );

        let org = &mut ctx.accounts.org_account;
        org.owner = new_owner;

        msg!("Org ownership transferred to {:?}", new_owner);
        Ok(())
    }
}

// ==========================================
// ACCOUNTS STRUCTS
// ==========================================

#[derive(Accounts)]
#[instruction(name: String, global_daily_cap: u64, global_monthly_cap: u64)]
pub struct CreateOrg<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + 32 + (4 + 64) + 8 + 8 + 8 + 8 + 2 + 2 + 8 + 1,
        seeds = [b"org", owner.key().as_ref()],
        bump
    )]
    pub org_account: Account<'info, OrgAccount>,

    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 1 + 8 + 1,
        seeds = [b"member", org_account.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub owner_member_account: Account<'info, MemberAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(team_id: u16, name: String, team_daily_cap: u64)]
pub struct CreateTeam<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut)]
    pub org_account: Account<'info, OrgAccount>,

    #[account(
        seeds = [b"member", org_account.key().as_ref(), caller.key().as_ref()],
        bump = caller_member_account.bump,
    )]
    pub caller_member_account: Account<'info, MemberAccount>,

    /// CHECK: The team lead user wallet
    pub team_lead: UncheckedAccount<'info>,

    #[account(
        init,
        payer = caller,
        space = 8 + 32 + 32 + 2 + (4 + 64) + 8 + 8 + 2 + 1,
        seeds = [b"team", org_account.key().as_ref(), &team_id.to_le_bytes()],
        bump
    )]
    pub team_account: Account<'info, TeamAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(role: u8)]
pub struct AddMember<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut)]
    pub org_account: Account<'info, OrgAccount>,

    #[account(
        seeds = [b"member", org_account.key().as_ref(), caller.key().as_ref()],
        bump = caller_member_account.bump,
    )]
    pub caller_member_account: Account<'info, MemberAccount>,

    /// CHECK: The new member's wallet address
    pub member_wallet: UncheckedAccount<'info>,

    #[account(
        init,
        payer = caller,
        space = 8 + 32 + 32 + 1 + 8 + 1,
        seeds = [b"member", org_account.key().as_ref(), member_wallet.key().as_ref()],
        bump
    )]
    pub new_member_account: Account<'info, MemberAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMemberRole<'info> {
    pub caller: Signer<'info>,

    pub org_account: Account<'info, OrgAccount>,

    #[account(
        seeds = [b"member", org_account.key().as_ref(), caller.key().as_ref()],
        bump = caller_member_account.bump,
    )]
    pub caller_member_account: Account<'info, MemberAccount>,

    #[account(
        mut,
        seeds = [b"member", org_account.key().as_ref(), target_member_account.member.as_ref()],
        bump = target_member_account.bump,
    )]
    pub target_member_account: Account<'info, MemberAccount>,
}

#[derive(Accounts)]
pub struct RemoveMember<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut)]
    pub org_account: Account<'info, OrgAccount>,

    #[account(
        seeds = [b"member", org_account.key().as_ref(), caller.key().as_ref()],
        bump = caller_member_account.bump,
    )]
    pub caller_member_account: Account<'info, MemberAccount>,

    #[account(
        mut,
        close = caller,
        seeds = [b"member", org_account.key().as_ref(), target_member_account.member.as_ref()],
        bump = target_member_account.bump,
    )]
    pub target_member_account: Account<'info, MemberAccount>,
}

#[derive(Accounts)]
pub struct UpdateOrgCaps<'info> {
    pub caller: Signer<'info>,

    #[account(mut)]
    pub org_account: Account<'info, OrgAccount>,

    #[account(
        seeds = [b"member", org_account.key().as_ref(), caller.key().as_ref()],
        bump = caller_member_account.bump,
    )]
    pub caller_member_account: Account<'info, MemberAccount>,
}

#[derive(Accounts)]
pub struct TransferOrgOwnership<'info> {
    pub owner: Signer<'info>,

    #[account(mut)]
    pub org_account: Account<'info, OrgAccount>,
}

// ==========================================
// STATE STRUCTS
// ==========================================

#[account]
pub struct OrgAccount {
    pub owner: Pubkey,
    pub name: String,
    pub global_daily_cap: u64,
    pub global_monthly_cap: u64,
    pub total_spent_today: u64,
    pub total_spent_month: u64,
    pub member_count: u16,
    pub agent_count: u16,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct TeamAccount {
    pub org: Pubkey,
    pub team_lead: Pubkey,
    pub team_id: u16,
    pub name: String,
    pub team_daily_cap: u64,
    pub team_spent_today: u64,
    pub agent_count: u16,
    pub bump: u8,
}

#[account]
pub struct MemberAccount {
    pub org: Pubkey,
    pub member: Pubkey,
    pub role: u8,
    pub joined_at: i64,
    pub bump: u8,
}

// ==========================================
// ERROR CODES
// ==========================================

#[error_code]
pub enum ErrorCode {
    #[msg("Name string is too long (max 64 characters)")]
    NameTooLong,
    #[msg("Invalid role level specified")]
    InvalidRole,
    #[msg("Caller does not possess adequate role permission for this instruction")]
    UnauthorizedRole,
}
