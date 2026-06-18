import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  subscription_tier: 'free' | 'pro' | 'business';
  created_at: string;
  updated_at: string;
}

export interface UsageLog {
  id: string;
  user_id: string;
  operation: string;
  file_size_mb: number;
  page_count: number;
  created_at: string;
}

export interface PDFJob {
  id: string;
  user_id: string;
  operation: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  input_files: any;
  output_file: string | null;
  options: any;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price_monthly: number;
  max_operations_per_month: number;
  max_file_size_mb: number;
  features: string[];
  active: boolean;
}
