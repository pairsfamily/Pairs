//! Pairs burner.
//!
//! Every coin launched on pairs.family has, as its pump.fun creator, the PDA `["burner", coin_mint]` of this program.
//! pump.fun pays that creator the coin's creator fees in the pair token (Q); anyone may sweep and collect them into the
//! PDA's Q account (pump.fun's own permissionless instructions). From there they can only go one way: `burn`, which
//! anyone may call, burns the account's whole balance. The PDA has no private key and this program has no other
//! instruction: nothing can withdraw, transfer, close or redirect what it holds. No admin, no config, no state.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn_checked, BurnChecked, Mint, TokenAccount, TokenInterface};

declare_id!("5TbC4U6rqpHqgdS4ngkmzkRPwP53bdeMoJrwhuAnVdS8");

pub const BURNER_SEED: &[u8] = b"burner";

#[program]
pub mod pairs_burner {
    use super::*;

    /// Burns every unit of `quote_mint` held by the coin's burner PDA in `burner_quote`. Permissionless. A zero
    /// balance is a no-op (succeeds, burns nothing), so a crank never fails on a quiet coin.
    pub fn burn(ctx: Context<Burn>) -> Result<()> {
        let amount = ctx.accounts.burner_quote.amount;
        if amount == 0 {
            return Ok(());
        }
        let coin = ctx.accounts.coin_mint.key();
        let seeds: &[&[u8]] = &[BURNER_SEED, coin.as_ref(), &[ctx.bumps.burner]];
        burn_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                BurnChecked {
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    from: ctx.accounts.burner_quote.to_account_info(),
                    authority: ctx.accounts.burner.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.quote_mint.decimals,
        )?;
        emit!(Burned { coin_mint: coin, quote_mint: ctx.accounts.quote_mint.key(), amount });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Burn<'info> {
    /// CHECK: only a seed: the coin whose fees these are. Any key derives its own burner; nothing is read from it.
    pub coin_mint: UncheckedAccount<'info>,
    /// CHECK: the coin's burner PDA. Holds no data; signs the burn through its seeds.
    #[account(seeds = [BURNER_SEED, coin_mint.key().as_ref()], bump)]
    pub burner: UncheckedAccount<'info>,
    /// The pair token (its supply drops by the burn).
    #[account(mut, mint::token_program = token_program)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    /// Any token account of the burner PDA for the pair token (its ATA in practice).
    #[account(mut, token::mint = quote_mint, token::authority = burner, token::token_program = token_program)]
    pub burner_quote: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct Burned {
    pub coin_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub amount: u64,
}
