'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { formatAmount } from '@/lib/format';
import { useSubmit } from '@/lib/use-submit';

interface Tool {
  id: string;
  vendor: string;
  product: string;
  category: string;
  approved: boolean;
  users: number;
  plans: { id: string; name: string; monthlyUsd: string | null; team: boolean }[];
}

const CATEGORY_LABEL: Record<string, string> = {
  chat: 'Chat assistants',
  coding: 'Coding',
  image: 'Images',
  video: 'Video',
  voice: 'Voice and audio',
  writing: 'Writing and productivity',
  search: 'Search',
  meetings: 'Meetings',
  api: 'APIs',
};

export function ApprovedToolsForm({ orgId, tools, editable }: { orgId: string; tools: Tool[]; editable: boolean }) {
  const { submit, pending, error } = useSubmit();
  const [approved, setApproved] = useState(new Set(tools.filter((t) => t.approved).map((t) => t.id)));
  const [filter, setFilter] = useState('');
  const visible = tools.filter((t) => `${t.product} ${t.vendor}`.toLowerCase().includes(filter.toLowerCase()));
  const categories = [...new Set(visible.map((t) => t.category))];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Filter tools"
          placeholder="Filter"
          className="w-64"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
        {editable ? (
          <Button
            disabled={pending}
            onClick={() => {
              submit(() =>
                api.PUT('/api/v1/orgs/{orgId}/tools/approved', {
                  params: { path: { orgId } },
                  body: { toolIds: [...approved] },
                }),
              );
            }}
          >
            Save approved list ({approved.size})
          </Button>
        ) : null}
        <FormError message={error} />
      </div>
      {categories.map((category) => (
        <section key={category} className="space-y-2">
          <h2 className="font-semibold">{CATEGORY_LABEL[category] ?? category}</h2>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visible
              .filter((t) => t.category === category)
              .map((tool) => (
                <li key={tool.id} className="flex items-start justify-between gap-3 border border-border p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={approved.has(tool.id)}
                      onChange={(e) => {
                        const next = new Set(approved);
                        if (e.target.checked) next.add(tool.id);
                        else next.delete(tool.id);
                        setApproved(next);
                      }}
                    />
                    <span>
                      <span className="block font-medium">{tool.product}</span>
                      <span className="block text-xs text-muted-foreground">
                        {tool.vendor} ·{' '}
                        {tool.plans
                          .filter((p) => p.monthlyUsd !== null)
                          .slice(0, 3)
                          .map((p) => `${p.name} ${formatAmount(p.monthlyUsd ?? '0', 'micros')}`)
                          .join(', ') || 'usage-based'}
                      </span>
                    </span>
                  </label>
                  {tool.users > 0 ? (
                    <Badge tone={approved.has(tool.id) ? 'accent' : 'danger'}>{tool.users} using</Badge>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">
        List prices as published by each vendor; used only for savings estimates.
      </p>
    </div>
  );
}
