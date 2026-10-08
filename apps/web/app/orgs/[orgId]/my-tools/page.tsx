import { Card, CardTitle, PageHeader } from '@/components/ui/card';
import { FormNotice } from '@/components/ui/form';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatAmount, formatDateTime } from '@/lib/format';
import { ConfirmTools, DeclareTools, ReceiptUpload, TelemetrySetup } from './my-tools-forms';

export default async function MyToolsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { orgId } = await params;
  const { welcome } = await searchParams;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, mine, catalogue] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/me/tools', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/tools', path).then(unwrap),
  ]);
  const confirmedRecently = mine.confirmedAt !== null && Date.now() - Date.parse(mine.confirmedAt) < 90 * 86_400_000;

  return (
    <>
      <PageHeader
        title={welcome === undefined ? 'My AI tools' : 'Connect your AI tools'}
        description="Tell your organization which AI tools you use. Each step takes under a minute; none of them shares what you type into those tools."
      />
      {welcome === undefined ? null : (
        <FormNotice>
          Welcome to {org.name}. Three optional steps: forward your AI receipts, connect Claude Code, and declare the tools you use.
        </FormNotice>
      )}
      <div className="mt-6 grid gap-8 xl:grid-cols-2">
        <Card>
          <CardTitle action={<ConfirmTools orgId={orgId} confirmed={confirmedRecently} />}>1. The tools you use</CardTitle>
          <p className="mb-3 text-xs text-muted-foreground">
            {mine.confirmedAt === null ? 'Not confirmed yet.' : `Last confirmed ${formatDateTime(mine.confirmedAt, org.timezone)}.`} We ask every
            quarter.
          </p>
          <DeclareTools
            orgId={orgId}
            catalogue={catalogue.tools.map((t) => ({ id: t.id, product: t.product, plans: t.plans, approved: t.approved }))}
            current={mine.tools}
          />
        </Card>
        <div className="space-y-8">
          <Card>
            <CardTitle>2. Forward your AI receipts</CardTitle>
            {mine.receiptsAddress === null ? (
              <p className="text-sm text-muted-foreground">The receipts inbox isn’t set up on this instance yet. You can upload receipt emails instead.</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  Forward receipts from ChatGPT, Claude, Cursor, Midjourney, and other AI tools to{' '}
                  <span className="break-all font-mono">{mine.receiptsAddress}</span>
                </p>
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Set up a mail rule</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                    <li>Gmail: Settings → Forwarding → add the address; then a filter “from:(openai.com OR anthropic.com OR cursor.com)” → Forward to it.</li>
                    <li>Outlook: Settings → Mail → Rules → new rule “From contains openai.com, anthropic.com, cursor.com” → Forward to it.</li>
                  </ul>
                </details>
              </div>
            )}
            <ReceiptUpload orgId={orgId} />
            <p className="mt-3 text-xs text-muted-foreground">
              Aperture keeps only the vendor, plan, amount, and dates from a receipt; the email itself is discarded.
            </p>
          </Card>
          <Card>
            <CardTitle>3. Connect Claude Code</CardTitle>
            <TelemetrySetup orgId={orgId} tokens={mine.telemetryTokens} gatewayUrl={mine.gatewayUrl} />
            <p className="mt-3 text-sm">
              Last 30 days: {mine.telemetryUsage30d.sessions} sessions, {formatAmount(mine.telemetryUsage30d.cost, 'micros')} at API prices.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
