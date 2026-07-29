use std::cell::RefMut;
use std::str::FromStr;
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{
            transfer_hook::TransferHookAccount, PodStateWithExtensionsMut, BaseStateWithExtensionsMut,
        },
        pod::PodAccount,
    },
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("H23GKLcVrnYoEC7s7Ju4nxk2LXLbuGn441YNQsFC2WdG");

#[error_code]
pub enum PolicyError {
    #[msg("The agent policy is currently paused")]
    AgentPaused,
    #[msg("Single transaction cap exceeded")]
    PerTxLimitExceeded,
    #[msg("Daily spending cap exceeded")]
    DailyLimitExceeded,
    #[msg("Recipient is not in the approved allowlist")]
    RecipientNotAllowlisted,
    #[msg("Velocity cap exceeded (too many transactions per hour)")]
    VelocityLimitExceeded,
    #[msg("The token is not currently transferring")]
    IsNotCurrentlyTransferring,
    #[msg("Unauthorized: Not the policy owner")]
    UnauthorizedOwner,
    #[msg("Session has expired")]
    SessionExpired,
    #[msg("Session budget exceeded")]
    SessionBudgetExceeded,
    #[msg("Session is not yet active")]
    SessionNotStarted,
    #[msg("Invalid session policy linkage")]
    InvalidSessionPolicy,
    #[msg("Monthly spending cap exceeded")]
    MonthlyLimitExceeded,
    #[msg("Velocity cooldown time has not elapsed")]
    CooldownNotElapsed,
    #[msg("Transaction outside allowed time window")]
    TimeWindowViolation,
    #[msg("Delegated sub-agent budget exceeded")]
    DelegatedBudgetExceeded,
    #[msg("Transaction exceeds escalation threshold and requires human approval")]
    EscalationRequired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SessionAccountOffline {
    pub policy: Pubkey,
    pub session_id: Pubkey,
    pub budget: u64,
    pub spent: u64,
    pub starts_at: i64,
    pub expires_at: i64,
    pub auto_renew: bool,
    pub bump: u8,
}

#[program]
pub mod policy_manager {
    use super::*;

    pub fn create_policy(
        ctx: Context<CreatePolicy>,
        daily_limit: u64,
        per_tx_limit: u64,
        allowlist: Vec<Pubkey>,
        velocity_max_tx_per_hour: u16,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy_account;
        policy.owner = ctx.accounts.owner.key();
        policy.agent = ctx.accounts.agent.key();
        policy.daily_limit = daily_limit;
        policy.per_tx_limit = per_tx_limit;
        policy.spent_today = 0;
        policy.last_reset_ts = Clock::get()?.unix_timestamp;
        policy.allowlist = allowlist;
        policy.is_paused = false;
        policy.velocity_max_tx_per_hour = velocity_max_tx_per_hour;
        policy.tx_count_this_hour = 0;
        policy.hour_window_start = Clock::get()?.unix_timestamp;
        policy.bump = ctx.bumps.policy_account;
        policy.org = Pubkey::default();
        policy.team = Pubkey::default();

        msg!("Policy created for agent: {:?}", policy.agent);
        Ok(())
    }

    pub fn create_org_policy(
        ctx: Context<CreatePolicy>,
        daily_limit: u64,
        per_tx_limit: u64,
        allowlist: Vec<Pubkey>,
        velocity_max_tx_per_hour: u16,
        org: Pubkey,
        team: Pubkey,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy_account;
        policy.owner = ctx.accounts.owner.key();
        policy.agent = ctx.accounts.agent.key();
        policy.daily_limit = daily_limit;
        policy.per_tx_limit = per_tx_limit;
        policy.spent_today = 0;
        policy.last_reset_ts = Clock::get()?.unix_timestamp;
        policy.allowlist = allowlist;
        policy.is_paused = false;
        policy.velocity_max_tx_per_hour = velocity_max_tx_per_hour;
        policy.tx_count_this_hour = 0;
        policy.hour_window_start = Clock::get()?.unix_timestamp;
        policy.bump = ctx.bumps.policy_account;
        policy.org = org;
        policy.team = team;

        msg!("Org Policy created for agent: {:?} (Org: {:?}, Team: {:?})", policy.agent, org, team);
        Ok(())
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        daily_limit: u64,
        per_tx_limit: u64,
        allowlist: Vec<Pubkey>,
        velocity_max_tx_per_hour: u16,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy_account;
        policy.daily_limit = daily_limit;
        policy.per_tx_limit = per_tx_limit;
        policy.allowlist = allowlist;
        policy.velocity_max_tx_per_hour = velocity_max_tx_per_hour;

        msg!("Policy updated for agent: {:?}", policy.agent);
        Ok(())
    }

    pub fn pause_agent(ctx: Context<UpdatePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy_account;
        policy.is_paused = true;
        msg!("Policy paused for agent: {:?}", policy.agent);
        Ok(())
    }

    pub fn resume_agent(ctx: Context<UpdatePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy_account;
        policy.is_paused = false;
        msg!("Policy resumed for agent: {:?}", policy.agent);
        Ok(())
    }

    pub fn emergency_clawback(ctx: Context<EmergencyClawback>, amount: u64) -> Result<()> {
        // Verify policy owner matches caller in an explicit scope to drop RefCell borrow before CPI
        {
            let policy_data = ctx.accounts.policy_account.try_borrow_data()?;
            if policy_data.len() < 8 {
                return err!(PolicyError::UnauthorizedOwner);
            }
            let mut data_slice = &policy_data[8..];
            let policy_acc = SessionAccountOffline::deserialize(&mut data_slice)?; // owner is at same offset
            if policy_acc.policy != ctx.accounts.owner.key() { // owner field in PolicyAccount is first pubkey after discriminator
                return err!(PolicyError::UnauthorizedOwner);
            }
        }

        let owner_key = ctx.accounts.owner.key();
        let delegate_seeds = &[
            b"delegate",
            owner_key.as_ref(),
            &[ctx.bumps.delegate_pda],
        ];
        let signer_seeds = &[&delegate_seeds[..]];

        msg!("Emergency clawback - owner: {:?}", owner_key);
        msg!("Emergency clawback - delegate_pda: {:?}", ctx.accounts.delegate_pda.key());
        msg!("Emergency clawback - policy_account: {:?}", ctx.accounts.policy_account.key());
        msg!("Emergency clawback - session_account: {:?}", ctx.accounts.session_account.key());
        msg!("Emergency clawback - session_tracker_program: {:?}", ctx.accounts.session_tracker_program.key());

        msg!("Executing clawback using permanent delegate (burn from agent, mint to recovery)...");
        
        // 1. Burn tokens from agent account using permanent delegate PDA
        anchor_spl::token_2022::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_interface::Burn {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    from: ctx.accounts.agent_token_account.to_account_info(),
                    authority: ctx.accounts.delegate_pda.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // 2. Mint replacement tokens to recovery account using mint authority
        anchor_spl::token_2022::mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_interface::MintTo {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.recovery_token_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        msg!("Clawback successful! Transferred: {}", amount);
        Ok(())
    }

    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let extra_account_metas = InitializeExtraAccountMetaList::extra_account_metas()?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &extra_account_metas,
        ).map_err(|_| ProgramError::InvalidAccountData)?;

        msg!("ExtraAccountMetaList initialized!");
        Ok(())
    }

    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        // Detect emergency clawback: check if authority (index 3) matches the delegate PDA
        // derived from the policy owner. The delegate PDA cannot sign normal transfers,
        // so matching it proves this is a legitimate clawback.
        let (expected_delegate, _) = Pubkey::find_program_address(
            &[b"delegate", ctx.accounts.policy_account.owner.as_ref()],
            ctx.program_id,
        );
        if ctx.accounts.owner.key() == expected_delegate {
            msg!("Emergency clawback authority detected. Bypassing policy checks.");
            return Ok(());
        }

        check_is_transferring(&ctx)?;

        let policy = &mut ctx.accounts.policy_account;

        if policy.is_paused {
            return err!(PolicyError::AgentPaused);
        }

        let now = Clock::get()?.unix_timestamp;

        if now - policy.last_reset_ts >= 86400 {
            policy.spent_today = 0;
            policy.last_reset_ts = now;
        }

        if amount > policy.per_tx_limit {
            return err!(PolicyError::PerTxLimitExceeded);
        }

        if policy.spent_today + amount > policy.daily_limit {
            return err!(PolicyError::DailyLimitExceeded);
        }

        // Axis 1: Monthly limit check
        if policy.monthly_limit > 0 {
            if now - policy.last_month_reset_ts >= 2592000 {
                policy.spent_this_month = 0;
                policy.last_month_reset_ts = now;
            }
            if policy.spent_this_month + amount > policy.monthly_limit {
                return err!(PolicyError::MonthlyLimitExceeded);
            }
        }

        // Axis 2: Velocity cooldown check
        if policy.cooldown_seconds > 0 && policy.last_tx_ts > 0 {
            if now - policy.last_tx_ts < policy.cooldown_seconds as i64 {
                return err!(PolicyError::CooldownNotElapsed);
            }
        }

        // Axis 4: Time window check
        if policy.allowed_hours_end > policy.allowed_hours_start {
            let current_hour = ((now / 3600) % 24) as u8;
            if current_hour < policy.allowed_hours_start || current_hour > policy.allowed_hours_end {
                return err!(PolicyError::TimeWindowViolation);
            }
        }

        // Axis 5: Escalation threshold check
        if policy.escalation_threshold > 0 && amount > policy.escalation_threshold {
            return err!(PolicyError::EscalationRequired);
        }

        if !policy.allowlist.is_empty() {
            let recipient = ctx.accounts.destination_token.owner;
            if !policy.allowlist.contains(&recipient) {
                return err!(PolicyError::RecipientNotAllowlisted);
            }
        }

        if now - policy.hour_window_start >= 3600 {
            policy.tx_count_this_hour = 1;
            policy.hour_window_start = now;
        } else {
            if policy.tx_count_this_hour >= policy.velocity_max_tx_per_hour {
                return err!(PolicyError::VelocityLimitExceeded);
            }
            policy.tx_count_this_hour += 1;
        }

        policy.spent_today += amount;
        policy.spent_this_month += amount;
        policy.last_tx_ts = now;

        // Verify and update session budget if session account belongs to the session-tracker program
        let session_info = &ctx.accounts.session_account;
        let session_program_id = Pubkey::from_str("DiaiUEypUnGti22wFmKLC9V4NDHmdQgHvpzsXw9e5r14").unwrap();
        if session_info.owner == &session_program_id {
            // Build the Anchor SpendSession method discriminator on-chain
            let mut hasher = anchor_lang::solana_program::hash::Hasher::default();
            hasher.hash(b"global:spend_session");
            let hash = hasher.result();
            let mut discriminator = [0u8; 8];
            discriminator.copy_from_slice(&hash.to_bytes()[..8]);

            let spend_ix = anchor_lang::solana_program::instruction::Instruction {
                program_id: session_program_id,
                accounts: vec![
                    anchor_lang::solana_program::instruction::AccountMeta::new_readonly(policy.key(), false),
                    anchor_lang::solana_program::instruction::AccountMeta::new(session_info.key(), false),
                ],
                data: {
                    let mut data = Vec::with_capacity(16);
                    data.extend_from_slice(&discriminator);
                    data.extend_from_slice(&amount.to_le_bytes());
                    data
                },
            };

            anchor_lang::solana_program::program::invoke(
                &spend_ix,
                &[
                    policy.to_account_info(),
                    session_info.to_account_info(),
                ],
            )?;
        }

        policy.spent_today += amount;
        msg!("Transfer approved! Remaining daily budget: {}", policy.daily_limit - policy.spent_today);
        Ok(())
    }

    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        ix_data: &[u8],
    ) -> Result<()> {
        let mut ix_data: &[u8] = ix_data;
        if ix_data.len() < 8 {
            return Err(ProgramError::InvalidInstructionData.into());
        }
        let sighash: [u8; 8] = {
            let mut sighash: [u8; 8] = [0; 8];
            sighash.copy_from_slice(&ix_data[..8]);
            ix_data = &ix_data[8..];
            sighash
        };

        const EXECUTE_IX_TAG_LE: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];

        match sighash {
            EXECUTE_IX_TAG_LE => {
                __private::__global::transfer_hook(program_id, accounts, ix_data)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}

pub fn check_is_transferring(ctx: &Context<TransferHook>) -> Result<()> {
    let source_token_info = ctx.accounts.source_token.to_account_info();
    let mut account_data_ref: RefMut<&mut [u8]> = source_token_info.try_borrow_mut_data()?;
    let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(*account_data_ref)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let account_extension = account.get_extension_mut::<TransferHookAccount>()
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if !bool::from(account_extension.transferring) {
        return err!(PolicyError::IsNotCurrentlyTransferring);
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CreatePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: The agent wallet governed by this policy
    pub agent: AccountInfo<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + PolicyAccount::INIT_SPACE,
        seeds = [b"policy", agent.key().as_ref()],
        bump
    )]
    pub policy_account: Account<'info, PolicyAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"policy", policy_account.agent.as_ref()],
        bump = policy_account.bump,
        has_one = owner @ PolicyError::UnauthorizedOwner,
    )]
    pub policy_account: Account<'info, PolicyAccount>,
}

#[derive(Accounts)]
pub struct EmergencyClawback<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: The agent wallet whose tokens are being reclaimed
    pub agent: AccountInfo<'info>,
    /// CHECK: Policy Account PDA (unchecked to avoid RefCell borrow during transfer hook CPI)
    #[account(
        mut,
        seeds = [b"policy", agent.key().as_ref()],
        bump,
    )]
    pub policy_account: UncheckedAccount<'info>,
    #[account(mut)]
    pub agent_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub recovery_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: The delegate PDA that holds the permanent delegate authority of the mint
    #[account(
        seeds = [b"delegate", owner.key().as_ref()],
        bump,
    )]
    pub delegate_pda: AccountInfo<'info>,
    /// CHECK: ExtraAccountMetaList Account required for transfer hook CPI
    #[account(seeds = [b"extra-account-metas", token_mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// CHECK: The Policy Manager Program itself (transfer hook program)
    pub policy_manager_program: AccountInfo<'info>,
    /// CHECK: The Session Tracker Program itself
    pub session_tracker_program: AccountInfo<'info>,
    /// CHECK: Session Account PDA (needed for transfer hook CPI remaining accounts)
    #[account(mut)]
    pub session_account: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: ExtraAccountMetaList Account
    #[account(
        init,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(
            InitializeExtraAccountMetaList::extra_account_metas_count()
        ).unwrap(),
        payer = payer
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExtraAccountMetaList<'info> {
    pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
        Ok(vec![
            // Extra meta [0] → resolved at Execute instruction Index 5.
            // Static: Session Tracker Program ID
            ExtraAccountMeta::new_with_pubkey(
                &Pubkey::from_str("DiaiUEypUnGti22wFmKLC9V4NDHmdQgHvpzsXw9e5r14").unwrap(),
                false, // is_signer
                false, // is_writable
            ).map_err(|_| ProgramError::InvalidArgument)?,
            // Extra meta [1] → resolved at Execute instruction Index 6.
            // PDA derived from policy-manager program using source token account owner.
            // AccountData reads bytes 32..64 of account 0 (source token) = the owner Pubkey.
            // This works for BOTH normal transfers (owner=agent) and clawback (owner=delegate)
            // because both share the same source token account whose owner is always the agent.
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"policy".to_vec(),
                    },
                    Seed::AccountData {
                        account_index: 0, // Source Token Account (execute instruction index 0)
                        data_index: 32,   // Owner field offset in SPL Token Account struct
                        length: 32,       // 32 bytes (Pubkey)
                    },
                ],
                false, // is_signer
                true,  // is_writable
            ).map_err(|_| ProgramError::InvalidArgument)?,
            // Extra meta [2] → resolved at Execute instruction Index 7.
            // External PDA derived via the session-tracker program using the policy account key.
            ExtraAccountMeta::new_external_pda_with_seeds(
                5, // session_tracker program is at execute instruction Index 5
                &[
                    Seed::Literal {
                        bytes: b"session".to_vec(),
                    },
                    Seed::AccountKey {
                        index: 6, // Policy Account is at execute instruction Index 6
                    },
                ],
                false, // is_signer
                true,  // is_writable
            ).map_err(|_| ProgramError::InvalidArgument)?,
        ])
    }

    pub fn extra_account_metas_count() -> usize {
        3
    }
}

/// TransferHook accounts struct.
/// During normal transfers: owner (index 3) = agent.
/// During clawback via permanent delegate: owner (index 3) = delegate_pda.
/// The policy_account is resolved by Token-2022 using AccountData from the source
/// token account (always the agent), so it's correct in both cases.
/// We remove seeds/authority constraints here and validate in the instruction body.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Transfer authority - agent for normal transfers, delegate PDA for clawback
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account
    #[account(seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// CHECK: Session Tracker Program Account (extra meta 0, Index 5)
    pub session_tracker_program: UncheckedAccount<'info>,
    /// CHECK: Policy Account (extra meta 1, Index 6) - PDA verified in instruction body
    #[account(mut)]
    pub policy_account: Account<'info, PolicyAccount>,
    /// CHECK: Session Tracker PDA (extra meta 2, Index 7)
    #[account(mut)]
    pub session_account: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct PolicyAccount {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub daily_limit: u64,
    pub per_tx_limit: u64,
    pub spent_today: u64,
    pub last_reset_ts: i64,
    #[max_len(10)]
    pub allowlist: Vec<Pubkey>,
    pub is_paused: bool,
    pub velocity_max_tx_per_hour: u16,
    pub tx_count_this_hour: u16,
    pub hour_window_start: i64,
    pub bump: u8,
    pub org: Pubkey,
    pub team: Pubkey,
    pub monthly_limit: u64,
    pub spent_this_month: u64,
    pub last_month_reset_ts: i64,
    pub cooldown_seconds: u32,
    pub last_tx_ts: i64,
    pub domain_allowlist_hash: [u8; 32],
    pub require_kyc: bool,
    pub allowed_hours_start: u8,
    pub allowed_hours_end: u8,
    pub allowed_days_bitmask: u8,
    pub escalation_threshold: u64,
    pub escalation_timeout_action: u8,
    pub escalation_timeout_minutes: u16,
    pub parent_policy: Option<Pubkey>,
    pub delegated_budget: u64,
    pub can_redelegate: bool,
    pub delegation_depth: u8,
}
