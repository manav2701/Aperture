use anchor_lang::prelude::*;

declare_id!("DiaiUEypUnGti22wFmKLC9V4NDHmdQgHvpzsXw9e5r14");

#[error_code]
pub enum SessionError {
    #[msg("Session has expired")]
    SessionExpired,
    #[msg("Session budget exceeded")]
    BudgetExceeded,
    #[msg("Session is not yet active")]
    SessionNotStarted,
    #[msg("Unauthorized: Not the policy owner")]
    UnauthorizedOwner,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct PolicyAccountOffline {
    pub owner: Pubkey,
}

#[program]
pub mod session_tracker {
    use super::*;

    pub fn open_session(
        ctx: Context<OpenSession>,
        session_id: Pubkey,
        budget: u64,
        starts_at: i64,
        expires_at: i64,
        auto_renew: bool,
    ) -> Result<()> {
        // Verify policy owner matches the caller
        let policy_data = ctx.accounts.policy.try_borrow_data()?;
        if policy_data.len() < 8 {
            return err!(SessionError::UnauthorizedOwner);
        }
        let mut data_slice = &policy_data[8..];
        let policy_acc = PolicyAccountOffline::deserialize(&mut data_slice)?;
        if policy_acc.owner != ctx.accounts.owner.key() {
            return err!(SessionError::UnauthorizedOwner);
        }

        let session = &mut ctx.accounts.session_account;
        session.policy = ctx.accounts.policy.key();
        session.session_id = session_id;
        session.budget = budget;
        session.spent = 0;
        session.starts_at = starts_at;
        session.expires_at = expires_at;
        session.auto_renew = auto_renew;
        session.bump = ctx.bumps.session_account;

        msg!("Session opened for policy: {:?}", session.policy);
        Ok(())
    }

    pub fn renew_session(
        ctx: Context<RenewSession>,
        budget: u64,
        expires_at: i64,
    ) -> Result<()> {
        // Verify policy owner matches the caller
        let policy_data = ctx.accounts.policy.try_borrow_data()?;
        if policy_data.len() < 8 {
            return err!(SessionError::UnauthorizedOwner);
        }
        let mut data_slice = &policy_data[8..];
        let policy_acc = PolicyAccountOffline::deserialize(&mut data_slice)?;
        if policy_acc.owner != ctx.accounts.owner.key() {
            return err!(SessionError::UnauthorizedOwner);
        }

        let session = &mut ctx.accounts.session_account;
        session.budget = budget;
        session.expires_at = expires_at;
        session.spent = 0; // Reset spent amount on manual renewal

        msg!("Session renewed. New budget: {}, New expiry: {}", budget, expires_at);
        Ok(())
    }

    pub fn close_session(ctx: Context<CloseSession>) -> Result<()> {
        // Verify policy owner matches the caller
        let policy_data = ctx.accounts.policy.try_borrow_data()?;
        if policy_data.len() < 8 {
            return err!(SessionError::UnauthorizedOwner);
        }
        let mut data_slice = &policy_data[8..];
        let policy_acc = PolicyAccountOffline::deserialize(&mut data_slice)?;
        if policy_acc.owner != ctx.accounts.owner.key() {
            return err!(SessionError::UnauthorizedOwner);
        }

        msg!("Session closed. Rent returned to owner.");
        Ok(())
    }

    pub fn spend_session(ctx: Context<SpendSession>, amount: u64) -> Result<()> {
        let session = &mut ctx.accounts.session_account;
        
        let now = Clock::get()?.unix_timestamp;
        if now < session.starts_at {
            return err!(SessionError::SessionNotStarted);
        }
        if now > session.expires_at {
            return err!(SessionError::SessionExpired);
        }
        if session.spent + amount > session.budget {
            return err!(SessionError::BudgetExceeded);
        }
        
        session.spent += amount;
        msg!("Spent {} from session. Remaining budget: {}", amount, session.budget - session.spent);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct OpenSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: The linked PolicyAccount (owner field is checked in the function body)
    pub policy: AccountInfo<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + SessionAccount::INIT_SPACE,
        seeds = [b"session", policy.key().as_ref()],
        bump
    )]
    pub session_account: Account<'info, SessionAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RenewSession<'info> {
    pub owner: Signer<'info>,
    /// CHECK: The linked PolicyAccount (owner field is checked in the function body)
    pub policy: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"session", policy.key().as_ref()],
        bump = session_account.bump,
    )]
    pub session_account: Account<'info, SessionAccount>,
}

#[derive(Accounts)]
pub struct CloseSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: The linked PolicyAccount (owner field is checked in the function body)
    pub policy: AccountInfo<'info>,
    #[account(
        mut,
        close = owner,
        seeds = [b"session", policy.key().as_ref()],
        bump = session_account.bump,
    )]
    pub session_account: Account<'info, SessionAccount>,
}

#[derive(Accounts)]
pub struct SpendSession<'info> {
    /// CHECK: Checked against linked policy key in transfer hook program
    pub policy: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"session", policy.key().as_ref()],
        bump = session_account.bump,
    )]
    pub session_account: Account<'info, SessionAccount>,
}

#[account]
#[derive(InitSpace)]
pub struct SessionAccount {
    pub policy: Pubkey,
    pub session_id: Pubkey,
    pub budget: u64,
    pub spent: u64,
    pub starts_at: i64,
    pub expires_at: i64,
    pub auto_renew: bool,
    pub bump: u8,
}
