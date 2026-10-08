import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { MimeError, dkimPassDomains, parseEmail, parseReceipt, toolById, type ParsedReceipt } from '@aperture/core';
import {
  and,
  convertToMicros,
  eq,
  ne,
  schema,
  sql,
  upsertSeat,
  withOrg,
  withSystem,
  type Transaction,
} from '@aperture/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { v7 as uuidv7 } from 'uuid';
import type { AppDeps, AppEnv } from './http/context';
import { AppError, errorBody } from './http/errors';

/*
 * The receipts inbox (plan/phases/phase-12 §12.3, decisions D12-4 and D12-5). Data minimisation:
 * after extraction the email body and attachments are discarded; only the parsed fields and a
 * SHA-256 of the raw message are stored. Subscriptions become seats; one-off purchases become
 * external spend. Neither touches the ledger (INV-17).
 */

const MAX_INBOUND_BYTES = 6 * 1024 * 1024;

export interface ReceiptOutcome {
  id: string;
  duplicate: boolean;
  status: 'imported' | 'review' | 'dismissed';
  reason: string | null;
  toolId: string | null;
  plan: string | null;
  amount: string | null;
  currency: string | null;
  occurredOn: string | null;
}

/** A receipt that parsed cleanly: a seat for subscriptions, external spend for one-off charges. */
export async function importParsedReceipt(
  tx: Transaction,
  input: {
    orgId: string;
    receiptId: string;
    userId: string | null;
    parsed: ParsedReceipt;
    amountMicros: bigint;
    messageHash: string;
  },
): Promise<{ seatId: string | null; externalSpendId: string | null }> {
  const { parsed } = input;
  const tool = parsed.toolId === null ? undefined : toolById(parsed.toolId);
  if (tool === undefined || parsed.occurredOn === null || parsed.amount === null || parsed.currency === null)
    return { seatId: null, externalSpendId: null };
  if (!parsed.oneOff) {
    // S2: a team-plan receipt for a seat a connector already reports is evidence for that seat,
    // not a second seat. A personal plan stays separate, so "paid twice" still shows.
    const teamPlan = tool.plans.some((plan) => plan.id === parsed.plan && plan.team);
    if (teamPlan && input.userId !== null) {
      const [reported] = await tx
        .select({ id: schema.seats.id })
        .from(schema.seats)
        .where(
          and(
            eq(schema.seats.orgId, input.orgId),
            eq(schema.seats.userId, input.userId),
            eq(schema.seats.toolId, tool.id),
            eq(schema.seats.source, 'connector'),
            ne(schema.seats.status, 'cancelled'),
          ),
        )
        .limit(1);
      if (reported !== undefined) {
        // The connector's data wins; the receipt only fills a cost the connector didn't report.
        await tx
          .update(schema.seats)
          .set({ monthlyCost: sql`coalesce(${schema.seats.monthlyCost}, ${input.amountMicros})` })
          .where(eq(schema.seats.id, reported.id));
        return { seatId: reported.id, externalSpendId: null };
      }
    }
    const { id } = await upsertSeat(tx, {
      orgId: input.orgId,
      dedupeKey: `receipt:${input.userId ?? parsed.vendorDomain ?? 'unknown'}:${tool.id}`,
      toolId: tool.id,
      plan: parsed.plan,
      userId: input.userId,
      externalUserRef: null,
      source: 'receipt',
      payer: 'unknown',
      monthlyCost: input.amountMicros,
      originalAmount: parsed.amount,
      currency: parsed.currency,
      renewsOn: parsed.renewsOn,
    });
    return { seatId: id, externalSpendId: null };
  }
  const id = uuidv7();
  const inserted = await tx
    .insert(schema.externalSpend)
    .values({
      id,
      orgId: input.orgId,
      occurredOn: parsed.occurredOn,
      amount: input.amountMicros,
      originalAmount: parsed.amount,
      originalCurrency: parsed.currency,
      descriptor: `${tool.product} receipt`,
      toolId: tool.id,
      vendor: tool.vendor,
      category: tool.category,
      source: 'receipt',
      receiptId: input.receiptId,
      dedupeHash: input.messageHash,
    })
    .onConflictDoNothing()
    .returning({ id: schema.externalSpend.id });
  return { seatId: null, externalSpendId: inserted[0]?.id ?? null };
}

/** Parses, deduplicates, and stores one receipt email for an org. */
export async function processReceipt(
  deps: AppDeps,
  input: {
    orgId: string;
    raw: Uint8Array;
    via: 'inbound_email' | 'upload';
    submittedBy: string | null;
    fromMember: boolean;
  },
): Promise<ReceiptOutcome> {
  let email;
  try {
    email = parseEmail(input.raw);
  } catch (error) {
    if (error instanceof MimeError) throw new AppError(400, 'invalid_email', error.message);
    throw error;
  }
  const messageHash = createHash('sha256').update(input.raw).digest('hex');
  const dkim = deps.inboundEmail?.authservId === undefined ? [] : dkimPassDomains(email, deps.inboundEmail.authservId);
  const parsed = parseReceipt(email, { dkimPassDomains: dkim, fromMember: input.fromMember });

  return withOrg(deps.db, input.orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.receipts)
      .where(and(eq(schema.receipts.orgId, input.orgId), eq(schema.receipts.messageHash, messageHash)));
    if (existing)
      return {
        id: existing.id,
        duplicate: true,
        status: existing.status,
        reason: existing.reason,
        toolId: existing.toolId,
        plan: existing.plan,
        amount: existing.originalAmount,
        currency: existing.currency,
        occurredOn: existing.occurredOn,
      };
    const amountMicros =
      parsed.amount === null || parsed.currency === null || parsed.occurredOn === null
        ? null
        : await convertToMicros(tx, parsed.amount, parsed.currency, parsed.occurredOn);
    let status = parsed.status;
    let reason = parsed.reason;
    if (status === 'imported' && amountMicros === null) {
      status = 'review';
      reason = `no exchange rate for ${parsed.currency ?? '?'}`;
    }
    const id = uuidv7();
    let links: { seatId: string | null; externalSpendId: string | null } = { seatId: null, externalSpendId: null };
    if (status === 'imported' && amountMicros !== null)
      links = await importParsedReceipt(tx, {
        orgId: input.orgId,
        receiptId: id,
        userId: input.submittedBy,
        parsed,
        amountMicros,
        messageHash,
      });
    await tx.insert(schema.receipts).values({
      id,
      orgId: input.orgId,
      via: input.via,
      submittedBy: input.submittedBy,
      senderDomain: parsed.vendorDomain,
      messageHash,
      status,
      reason,
      trust: parsed.trust,
      toolId: parsed.toolId,
      plan: parsed.plan,
      amount: amountMicros,
      originalAmount: parsed.amount,
      currency: parsed.currency,
      occurredOn: parsed.occurredOn,
      renewsOn: parsed.renewsOn,
      seatId: links.seatId,
      externalSpendId: links.externalSpendId,
    });
    return {
      id,
      duplicate: false,
      status,
      reason,
      toolId: parsed.toolId,
      plan: parsed.plan,
      amount: parsed.amount,
      currency: parsed.currency,
      occurredOn: parsed.occurredOn,
    };
  });
}

/** The org's receipts token, created on first use (an unguessable part of the address). */
export async function receiptsToken(deps: AppDeps, orgId: string): Promise<string> {
  return withOrg(deps.db, orgId, async (tx) => {
    const [settings] = await tx
      .select({ token: schema.orgSettings.receiptsToken })
      .from(schema.orgSettings)
      .where(eq(schema.orgSettings.orgId, orgId));
    if (settings?.token != null) return settings.token;
    const token = randomBytes(9)
      .toString('base64url')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, 'x');
    await tx
      .insert(schema.orgSettings)
      .values({ orgId, receiptsToken: token })
      .onConflictDoUpdate({
        target: schema.orgSettings.orgId,
        set: { receiptsToken: sql`coalesce(${schema.orgSettings.receiptsToken}, excluded.receipts_token)` },
      });
    const [after] = await tx
      .select({ token: schema.orgSettings.receiptsToken })
      .from(schema.orgSettings)
      .where(eq(schema.orgSettings.orgId, orgId));
    return after?.token ?? token;
  });
}

const RECIPIENT = /receipts-([a-z0-9]{6,40})@/i;

/**
 * Raw mail from the inbound forwarder: `POST /webhooks/inbound-email` with the RFC 822 message as
 * the body and `x-aperture-signature: sha256=<hex HMAC of the body>`. The recipient comes from
 * `x-aperture-recipient` (the envelope recipient) or the To header.
 */
export function registerInboundEmailWebhook(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  app.post(
    '/webhooks/inbound-email',
    bodyLimit({
      maxSize: MAX_INBOUND_BYTES,
      onError: (c) => c.json(errorBody('payload_too_large', 'the email is larger than 6 MB'), 413),
    }),
    async (c) => {
      const config = deps.inboundEmail;
      if (config === undefined) return c.json(errorBody('not_configured', 'the receipts inbox is not set up'), 404);
      const raw = new Uint8Array(await c.req.arrayBuffer());
      const signature = (c.req.header('x-aperture-signature') ?? '').replace(/^sha256=/, '');
      const expected = createHmac('sha256', config.secret).update(raw).digest('hex');
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
        return c.json(errorBody('invalid_signature', 'signature mismatch'), 401);

      let to = c.req.header('x-aperture-recipient') ?? '';
      if (!RECIPIENT.test(to)) {
        try {
          to = (parseEmail(raw).headers.get('to') ?? []).join(',');
        } catch {
          return c.json(errorBody('invalid_email', 'not an email'), 400);
        }
      }
      const token = RECIPIENT.exec(to)?.[1]?.toLowerCase();
      if (token === undefined)
        return c.json(errorBody('unknown_recipient', 'no receipts address in the recipients'), 404);
      const org = await withSystem(deps.db, (tx) =>
        tx
          .select({ orgId: schema.orgSettings.orgId })
          .from(schema.orgSettings)
          .where(eq(schema.orgSettings.receiptsToken, token)),
      );
      const orgId = org[0]?.orgId;
      // Unknown addresses look the same as known ones that dropped the mail: nothing to probe.
      if (orgId === undefined) return c.json({ accepted: true }, 202);

      let from: string | undefined;
      try {
        from = parseEmail(raw).from?.address;
      } catch {
        return c.json(errorBody('invalid_email', 'not an email'), 400);
      }
      const member =
        from === undefined
          ? undefined
          : (
              await withOrg(deps.db, orgId, (tx) =>
                tx
                  .select({ userId: schema.users.id })
                  .from(schema.members)
                  .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
                  .where(
                    and(
                      eq(schema.members.orgId, orgId),
                      eq(schema.users.email, from),
                      eq(schema.users.emailVerified, true),
                    ),
                  ),
              )
            )[0];
      try {
        const outcome = await processReceipt(deps, {
          orgId,
          raw,
          via: 'inbound_email',
          submittedBy: member?.userId ?? null,
          fromMember: member !== undefined,
        });
        return c.json({ accepted: true, status: outcome.status, duplicate: outcome.duplicate }, 202);
      } catch (error) {
        if (error instanceof AppError) return c.json(errorBody(error.code, error.message), error.status);
        throw error;
      }
    },
  );
}
