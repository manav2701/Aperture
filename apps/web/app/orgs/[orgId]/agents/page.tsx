import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { AgentActions, PauseAll, RevokeKey } from './agent-actions';
import { NewAgent } from './new-agent';

export default async function AgentsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { agents }, { keys }, { teams }, workspace] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/agents', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/keys', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/teams', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/workspace', path).then((result) => result.data),
  ]);
  const manage = can(org.role, 'agents.manage');
  const gatewayUrl = workspace?.gatewayUrl ?? null;
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? null;

  return (
    <>
      <PageHeader
        title="Agents & keys"
        description="Agents spend through the Aperture gateway with their own keys and budgets. Pausing one stops its next request."
        action={manage ? <PauseAll orgId={orgId} /> : undefined}
      />
      <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          {agents.length === 0 ? (
            <EmptyState>No agents yet.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {agents.map((agent) => (
                <li key={agent.id} className="space-y-3 border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{agent.name}</span>
                      <Badge tone={agent.status === 'active' ? 'accent' : 'danger'}>{agent.status}</Badge>
                      {teamName(agent.teamId) === null ? null : <Badge>{teamName(agent.teamId)}</Badge>}
                      <Badge>{agent.activeKeys} keys</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">owner {agent.owner?.name ?? '—'}</span>
                  </div>
                  {agent.description === null ? null : (
                    <p className="text-sm text-muted-foreground">{agent.description}</p>
                  )}
                  {manage ? <AgentActions orgId={orgId} agentId={agent.id} status={agent.status} /> : null}
                </li>
              ))}
            </ul>
          )}

          <Card>
            <CardTitle>Gateway keys</CardTitle>
            {keys.length === 0 ? (
              <EmptyState>No keys yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {keys.map((key) => (
                  <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-mono">{key.prefix}…</span> {key.name}{' '}
                      <span className="text-muted-foreground">· {key.principal.name}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(key.createdAt, org.timezone)}
                      </span>
                      {key.revokedAt === null ? (
                        <RevokeKey orgId={orgId} keyId={key.id} />
                      ) : (
                        <Badge tone="danger">revoked</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Use the gateway</CardTitle>
            {gatewayUrl === null ? (
              <p className="text-sm text-muted-foreground">The gateway isn’t enabled on this deployment yet.</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Point any OpenAI-compatible SDK at the gateway with an agent’s key:
                </p>
                <pre className="overflow-x-auto bg-muted p-3 font-mono text-xs">
                  {`curl ${gatewayUrl}/v1/chat/completions \\
  -H "Authorization: Bearer apk_…" -H "Content-Type: application/json" \\
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'`}
                </pre>
                <p className="text-muted-foreground">
                  Anthropic SDK: base URL <code className="font-mono">{gatewayUrl}/anthropic</code>. Gemini:{' '}
                  <code className="font-mono">{gatewayUrl}/google/v1beta/models/…:generateContent</code>.
                </p>
              </div>
            )}
          </Card>
        </div>

        {manage ? (
          <Card>
            <h2 className="mb-4 font-semibold">New agent</h2>
            <NewAgent orgId={orgId} teams={teams.filter((t) => !t.archived)} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
