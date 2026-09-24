'use client';

import { useMemo } from 'react';
import { Select } from '@/components/ui/form';

export function TimezoneSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf('timeZone');
    return all.includes(value) ? all : [value, ...all];
  }, [value]);
  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replaceAll('_', ' ')}
        </option>
      ))}
    </Select>
  );
}
