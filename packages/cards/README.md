# @aperture/cards

The fiat card rail. Aperture decides every authorization on the customer's own Stripe Issuing program, in real time, against budgets, policies and mandates. See ADR 0017.

| File           | What                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `stripe.ts`    | Signature verification, payload schemas, and a form-encoded client that refuses to request card numbers             |
| `fx.ts`        | Minor-unit conversion to µUSD (holds round up), daily rates (ECB via Frankfurter) and GCC pegs                      |
| `authorize.ts` | The hot path: one transaction, no network. Card → FX → mandate → policy → reserve → decision                        |
| `events.ts`    | Idempotent, order-independent state machine for authorizations, transactions and card updates                       |
| `cards.ts`     | Connect Stripe (company cardholder), issue agent and single-use task cards with backstop controls, freeze or cancel |

The webhook routes live in `apps/api/src/cards.ts`: `/webhooks/stripe/{connectionId}/authorization` and `/events`. The jobs `fx.sync`, `cards.expire` and `cards.reconcile` live in `@aperture/jobs`.

## Trying it (test mode)

1. Dashboard → Cards → connect a **test** restricted key. Put the two URLs into Stripe (set the timeout to decline), then paste their secrets.
2. Issue a card to an agent.
3. `STRIPE_TEST_KEY=sk_test_… pnpm try:card auth --card ic_… --amount 12.50` → approved. Then run `pnpm try:card capture --auth iauth_…`.
4. Set a card approval threshold of USD 100, then try `--amount 600`. It is declined and an approval appears. Approve it, and a single-use card is issued.
5. `pnpm try:card force-capture --card ic_… --amount 5` → an "unheld capture" alert.

Tests use Stripe-shaped fixtures (`@aperture/cards/testing`) because there is no sandbox access yet (D5).
