'use client';

import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Exam } from '@/types';

const EMPTY_QUERY_LIMIT = 80;
const SEARCH_RESULT_LIMIT = 200;

function searchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function examMatchesQuery(exam: Exam, search: string): boolean {
  const q = searchKey(search);
  if (!q) return true;
  return searchKey(exam.title).includes(q);
}

export type ExamComboboxProps = {
  exams: Exam[];
  value: string;
  onValueChange: (examId: string) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  /** Exámenes bloqueados por otra sesión (no se pueden elegir). */
  lockedExamIds?: ReadonlySet<string>;
  /** Texto opcional por examen bloqueado (p. ej. "En revisión"). */
  lockedExamHint?: string;
};

export function ExamCombobox({
  exams,
  value,
  onValueChange,
  disabled,
  id,
  placeholder = 'Busca CCT, grupo o materia…',
  searchPlaceholder = 'Ej. 26ETV0375Q o 1-A',
  emptyText = 'Ningún examen coincide con la búsqueda.',
  loading = false,
  lockedExamIds,
  lockedExamHint = 'En revisión por otro dispositivo',
}: ExamComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const selected = exams.find((e) => e.id === value);

  const filtered = React.useMemo(() => {
    const q = query.trim();
    const matches = q
      ? exams.filter((e) => examMatchesQuery(e, q))
      : exams;
    const limit = q ? SEARCH_RESULT_LIMIT : EMPTY_QUERY_LIMIT;
    return {
      items: matches.slice(0, limit),
      total: matches.length,
      truncated: matches.length > limit,
    };
  }, [exams, query]);

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    // Al abrir, foco inmediato en el buscador para escribir sin segundo clic.
    const focusSearch = () => searchInputRef.current?.focus({ preventScroll: true });
    focusSearch();
    const t = window.setTimeout(focusSearch, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="h-11 w-full justify-between px-3 font-normal"
        >
          <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
            {loading
              ? 'Cargando…'
              : selected
                ? selected.title
                : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-[var(--radix-popover-trigger-width)] max-w-[min(100vw-1.5rem,calc(var(--radix-popover-trigger-width)+4rem))] overflow-hidden p-0 shadow-lg"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchInputRef.current?.focus({ preventScroll: true });
        }}
      >
        <Command shouldFilter={false} className="flex max-h-[min(70vh,24rem)] flex-col overflow-hidden rounded-md border border-orange-200/90 bg-popover">
          <CommandInput
            ref={searchInputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            wrapperClassName="h-auto shrink-0 gap-2 border-0 border-b border-orange-200 bg-orange-50/60 px-3 py-3"
            className="h-11 rounded-lg border-2 border-orange-400 bg-white px-3 py-2 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:outline-none"
          />
          <CommandList className="max-h-[min(50vh,16rem)] overflow-y-auto overscroll-contain px-2 py-2">
            <CommandEmpty className="py-8 text-muted-foreground">{emptyText}</CommandEmpty>
            <CommandGroup className="p-0 [&_[cmdk-item]]:my-0.5 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:py-2.5">
              {filtered.items.map((e) => {
                const locked = Boolean(lockedExamIds?.has(e.id) && e.id !== value);
                return (
                  <CommandItem
                    key={e.id}
                    value={e.id}
                    disabled={locked}
                    onSelect={() => {
                      if (locked) return;
                      onValueChange(e.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        value === e.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className={cn('min-w-0 flex-1 truncate', locked && 'text-muted-foreground')}>
                      {e.title}
                    </span>
                    {locked ? (
                      <span className="ml-2 shrink-0 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                        {lockedExamHint}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {filtered.truncated ? (
              <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                Mostrando {filtered.items.length} de {filtered.total}. Sigue escribiendo para acotar.
              </p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
