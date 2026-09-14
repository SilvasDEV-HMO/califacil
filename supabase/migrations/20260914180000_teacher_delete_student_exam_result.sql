-- Maestro: borrar calificación/intento de un alumno (equivocación al calificar).
create or replace function public.teacher_delete_student_exam_result(
  p_exam_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.teacher_owns_exam(p_exam_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  perform set_config('row_security', 'off', true);

  delete from public.answers
  where exam_id = p_exam_id
    and student_id = p_student_id;

  delete from public.exam_attempts
  where exam_id = p_exam_id
    and student_id = p_student_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.teacher_delete_student_exam_result(uuid, uuid) to authenticated;
