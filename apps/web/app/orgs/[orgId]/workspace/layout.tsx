import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatAmount } from '@/lib/format';
import { NavLink } from '../nav-link';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const api = await serverApi();
  const workspace = unwrap(await api.GET('/api/v1/orgs/{orgId}/workspace', { params: { path: { orgId } } }));
  const base = `/orgs/${orgId}/workspace`;
  return (
    <>
      <PageHeader
        title="Workspace"
        description={
          workspace.remaining === null
            ? 'Chat, images and video under your organization’s policies.'
            : `You have ${formatAmount(workspace.remaining, 'micros')} left${workspace.budgetName === null ? '' : ` in “${workspace.budgetName}”`}.`
        }
      />
      <nav aria-label="Workspace" className="mb-6 flex gap-1 border-b border-border pb-2">
        <NavLink href={base} exact>
          Chat
        </NavLink>
        <NavLink href={`${base}/images`} exact={false}>
          Images
        </NavLink>
        <NavLink href={`${base}/videos`} exact={false}>
          Videos
        </NavLink>
      </nav>
      {children}
    </>
  );
}
