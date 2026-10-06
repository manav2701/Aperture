import { can, type Permission } from '@aperture/core';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
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
  { href: '/approvals', label: 'Approvals', permission: 'approvals.read' },
  { href: '/cards', label: 'Cards', permission: 'agents.read' },
  { href: '/crypto', label: 'Crypto', permission: 'agents.read' },
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
  const needsTwoFactor = ['owner', 'admin', 'finance'].includes(org.role) && !me.user.twoFactorEnabled;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-6 border-b border-border p-5 md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between">
          <Logo href="/app" />
          <ThemeToggle />
        </div>
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
                      <Link href={`/orgs/${m.orgId}`} className="hover:text-highlight">
                        {m.orgName}
                      </Link>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
          <p className="truncate text-muted-foreground">{me.user.email}</p>
          <Link href="/account/security" className="block hover:text-highlight">
            Security{me.user.twoFactorEnabled ? '' : ' · set up two-factor'}
          </Link>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-10">
        {needsTwoFactor ? (
          <p className="mb-6 border border-danger/40 bg-danger/10 p-3 text-sm">
            As {org.role.replace('_', ' ')}, you need two-factor authentication to make changes.{' '}
            <Link href="/account/security" className="font-medium underline">
              Set it up
            </Link>
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
