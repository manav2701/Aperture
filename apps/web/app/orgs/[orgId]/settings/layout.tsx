import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/card';
import { NavLink } from '../nav-link';

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const base = `/orgs/${(await params).orgId}/settings`;
  return (
    <>
      <PageHeader title="Settings" />
      <nav aria-label="Settings" className="mb-8 flex gap-1 border-b border-border pb-2">
        <NavLink href={base} exact>
          Organization
        </NavLink>
        <NavLink href={`${base}/members`} exact={false}>
          Members
        </NavLink>
        <NavLink href={`${base}/teams`} exact={false}>
          Teams
        </NavLink>
        <NavLink href={`${base}/alerts`} exact={false}>
          Alerts
        </NavLink>
      </nav>
      {children}
    </>
  );
}
