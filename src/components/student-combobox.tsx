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
import type { Student } from '@/types';

export type StudentComboboxProps = {
  students: Student[];
  value: string;
  onValueChange: (studentId: string) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  noStudentsText?: string;
};

export function StudentCombobox({
  students,
  value,
  onValueChange,
  disabled,
  id,
  placeholder = 'Busca y elige un alumno…',
  searchPlaceholder = 'Escribe para buscar…',
  emptyText = 'Ningún alumno coincide con la búsqueda.',
  noStudentsText = 'No hay alumnos registrados en el grupo de este examen. El maestro debe darlos de alta en Grupos.',
}: StudentComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = students.find((s) => s.id === value);

  const filter = React.useCallback(
    (itemValue: string, search: string) => {
      const student = students.find((s) => s.id === itemValue);
      if (!student) return 0;
      const q = search.trim().toLowerCase();
      if (!q) return 1;
      return student.name.toLowerCase().includes(q) ? 1 : 0;
    },
    [students]
  );

  if (students.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
        role="status"
      >
        {noStudentsText}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-11 w-full justify-between px-3 font-normal"
        >
          <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-[var(--radix-popover-trigger-width)] max-w-[min(100vw-1.5rem,calc(var(--radix-popover-trigger-width)+2rem))] overflow-hidden p-0 shadow-lg"
        align="start"
        sideOffset={6}
      >
        <Command
          filter={filter}
          className="flex max-h-[min(70vh,22rem)] flex-col overflow-hidden rounded-md border border-orange-200/90 bg-popover"
        >
          <CommandInput
            placeholder={searchPlaceholder}
            wrapperClassName="h-auto shrink-0 gap-2 border-0 border-b border-orange-200 bg-orange-50/60 px-3 py-3"
            className="h-11 rounded-lg border-2 border-orange-400 bg-white px-3 py-2 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:outline-none"
          />
          <CommandList className="max-h-[min(50vh,15rem)] overflow-y-auto overscroll-contain px-2 py-2">
            <CommandEmpty className="py-8 text-muted-foreground">{emptyText}</CommandEmpty>
            <CommandGroup className="p-0 [&_[cmdk-item]]:my-0.5 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:py-2.5">
              {students.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  onSelect={() => {
                    onValueChange(s.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === s.id ? 'opacity-100' : 'opacity-0')} />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
