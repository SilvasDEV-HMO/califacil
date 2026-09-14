export type VoidedAttemptRow = {
  student_id: string;
  student_name: string;
  group_id: string | null;
  void_reason: string | null;
  started_at: string;
  closed_at: string;
  duration_seconds: number;
};
