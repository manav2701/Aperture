# Give an org a pilot

Pilot orgs get every feature with no plan limits and no billing, until an end date.

```bash
DATABASE_URL=<owner url> pnpm --filter @aperture/cli admin pilot <orgId> 90
```

The org's Settings → Billing then shows "Pilot until …". When the pilot ends, the org falls back to the Free plan limits (existing resources keep working; new ones over the limit are refused) until someone subscribes.

Pilot checklist (plan/phases/phase-10 §10.10):

- an onboarding session, following the in-app getting-started steps;
- success criteria agreed from Phase 0;
- weekly check-ins, and a shared feedback channel.
