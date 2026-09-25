'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trycompai/design-system';
import { ORG_SORT_OPTIONS, parseOrgSort, type OrgSort } from './org-posture-sort';

export function PostureSortSelect({
  value,
  onChange,
}: {
  value: OrgSort;
  onChange: (sort: OrgSort) => void;
}) {
  const label = ORG_SORT_OPTIONS.find((o) => o.value === value)?.label ?? 'Sort';

  const handleValueChange = (next: string | null) => {
    onChange(parseOrgSort(next));
  };

  return (
    <div className="w-full sm:w-52" aria-label="Sort organizations">
      <Select value={value} onValueChange={handleValueChange}>
        <SelectTrigger size="sm">
          <SelectValue placeholder="Sort">{label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ORG_SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
