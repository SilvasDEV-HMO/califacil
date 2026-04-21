import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'http://127.0.0.1:54321';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  '00000000-0000-0000-0000-000000000000';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Mantener sesión compartida entre pestañas y recargas.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'califacil.auth.token',
  },
});

export type Database = {
  public: {
    tables: {
      groups: {
        Row: {
          id: string;
          teacher_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          teacher_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          teacher_id?: string;
          name?: string;
          created_at?: string;
        };
      };
      students: {
        Row: {
          id: string;
          group_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          name?: string;
          created_at?: string;
        };
      };
      exams: {
        Row: {
          id: string;
          teacher_id: string;
          group_id: string | null;
          title: string;
          description: string | null;
          qr_code: string | null;
          status: 'draft' | 'published' | 'closed';
          created_at: string;
        };
        Insert: {
          id?: string;
          teacher_id: string;
          group_id?: string | null;
          title: string;
          description?: string | null;
          qr_code?: string | null;
          status?: 'draft' | 'published' | 'closed';
          created_at?: string;
        };
        Update: {
          id?: string;
          teacher_id?: string;
          group_id?: string | null;
          title?: string;
          description?: string | null;
          qr_code?: string | null;
          status?: 'draft' | 'published' | 'closed';
          created_at?: string;
        };
      };
      questions: {
        Row: {
          id: string;
          exam_id: string;
          text: string;
          type: 'multiple_choice' | 'open_answer';
          options: string[] | null;
          correct_answer: string | null;
          illustration: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          exam_id: string;
          text: string;
          type: 'multiple_choice' | 'open_answer';
          options?: string[] | null;
          correct_answer?: string | null;
          illustration?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          exam_id?: string;
          text?: string;
          type?: 'multiple_choice' | 'open_answer';
          options?: string[] | null;
          correct_answer?: string | null;
          illustration?: string | null;
          created_at?: string;
        };
      };
      answers: {
        Row: {
          id: string;
          exam_id: string;
          student_id: string;
          question_id: string;
          answer_text: string;
          is_correct: boolean | null;
          score: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          exam_id: string;
          student_id: string;
          question_id: string;
          answer_text: string;
          is_correct?: boolean | null;
          score?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          exam_id?: string;
          student_id?: string;
          question_id?: string;
          answer_text?: string;
          is_correct?: boolean | null;
          score?: number | null;
          created_at?: string;
        };
      };
    };
  };
};
