alter table public.exams
  add column if not exists answer_key_source text not null default 'exam'
    check (answer_key_source in ('exam', 'teacher_sheet'));

alter table public.exams
  add column if not exists answer_key_by_question jsonb;
