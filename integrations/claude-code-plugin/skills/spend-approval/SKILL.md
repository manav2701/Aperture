---
name: spend-approval
description: Ask a person in the organization to approve an Aperture spend that policy or budget refused, then wait for the decision. Use when an Aperture tool returns aperture_approval_required, when estimate_cost says a step isn't allowed, or when the user asks you to request more budget.
---

1. Call `request_approval` with the exact model or purchase, the amount in USD, and a one-sentence reason the approver can judge without context.
2. Tell the user the approval id and that a person must decide (in the Aperture dashboard, by email, or in Slack).
3. Call `check_approval` with that id when the user asks, or before you retry. Don't poll in a tight loop.
   - `approved`: retry the original step once, with the approval id as Aperture asks. Stay within the approved amount, which can be less than you asked for.
   - `denied` or `expired`: stop that step and tell the user. Don't ask again for the same thing unless the user tells you to.
4. If you're about to do something the user didn't ask for and it would cost money, ask the user first, before you ask Aperture.

If the work must stop (a runaway loop, or a cost you can't explain), call `pause_self`. Only a person can resume you.
