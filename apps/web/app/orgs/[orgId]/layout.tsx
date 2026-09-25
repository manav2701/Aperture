import { can, type Permission } from '@aperture/core';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { serverApi, unwrap } from '@/lib/api/server';
import { NavLink } from './nav-link';
import { SignOutButton } from './sign-out-button';

const sections: { href: string; label: string; permission: Permission }[] = [
  { href: '', label: 'Overview', permission: 'org.read' },
  { href: '/workspace', label: 'Workspace', permission: 'workspace.use' },
  { href: '/spend', label: 'Spend', permission: 'spend.read' },
  { href: '/budgets', label: 'Budgets', permission: 'budgets.read' },
  { href: '/policies', label: 'Policies', permission: 'policies.read' },
  { href: '/agents', label: 'Agents & keys', permission: 'agents.read' },
  { href: '/connections', label: 'Connections', permission: 'connections.read' },
  { href: '/audit', label: 'Audit log', permission: 'audit.read' },
  { href: '/settings', label: 'Settings', permission: 'org.read' },
];

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const api = await serverApi();
  const [org, me] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', { params: { path: { orgId } } }).then(unwrap),
    api.GET('/api/v1/me').then(unwrap),
  ]);
  const base = `/orgs/${orgId}`;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-6 border-b border-border p-5 md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <Link href="/app" className="font-mono text-sm uppercase tracking-widest text-accent">
          Aperture
        </Link>
        <div className="space-y-1">
          <p className="truncate font-semibold">{org.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{org.role.replace('_', ' ')}</p>
        </div>
        <nav aria-label="Organization" className="flex flex-row flex-wrap gap-1 md:flex-col">
          {sections
            .filter((section) => can(org.role, section.permission))
            .map((section) => (
              <NavLink key={section.href} href={`${base}${section.href}`} exact={section.href === ''}>
                {section.label}
              </NavLink>
            ))}
        </nav>
        <div className="mt-auto space-y-3 text-sm">
          {me.memberships.length > 1 ? (
            <details>
              <summary className="cursor-pointer text-muted-foreground">Switch organization</summary>
              <ul className="mt-2 space-y-1">
                {me.memberships
                  .filter((m) => m.orgId !== orgId)
                  .map((m) => (
                    <li key={m.orgId}>
                      <Link href={`/orgs/${m.orgId}`} className="hover:text-accent">
                        {m.orgName}
                      </Link>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
          <p className="truncate text-muted-foreground">{me.user.email}</p>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-10">{children}</main>
    </div>
  );
}
