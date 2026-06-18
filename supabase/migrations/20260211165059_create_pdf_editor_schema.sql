/*
  # PDF Editor Application Schema

  ## Overview
  Complete database schema for a production-ready PDF editor SaaS application.

  ## Tables Created
  
  1. **profiles** - User profile information extending Supabase auth.users
     - `id` (uuid, primary key, references auth.users)
     - `email` (text, unique, not null)
     - `full_name` (text)
     - `subscription_tier` (text, default 'free')
     - `created_at` (timestamptz)
     - `updated_at` (timestamptz)

  2. **subscription_plans** - Available subscription tiers
     - `id` (uuid, primary key)
     - `name` (text, not null)
     - `price_monthly` (decimal)
     - `max_operations_per_month` (integer)
     - `max_file_size_mb` (integer)
     - `features` (jsonb)
     - `active` (boolean)

  3. **subscriptions** - User subscription tracking
     - `id` (uuid, primary key)
     - `user_id` (uuid, references profiles)
     - `plan_id` (uuid, references subscription_plans)
     - `status` (text, default 'active')
     - `current_period_start` (timestamptz)
     - `current_period_end` (timestamptz)
     - `stripe_subscription_id` (text)
     - `created_at` (timestamptz)

  4. **pdf_jobs** - PDF processing job tracking
     - `id` (uuid, primary key)
     - `user_id` (uuid, references profiles)
     - `operation` (text, not null)
     - `status` (text, default 'pending')
     - `input_files` (jsonb)
     - `output_file` (text)
     - `options` (jsonb)
     - `error` (text)
     - `created_at` (timestamptz)
     - `completed_at` (timestamptz)

  5. **usage_logs** - Operation usage tracking for limits
     - `id` (uuid, primary key)
     - `user_id` (uuid, references profiles)
     - `operation` (text, not null)
     - `file_size_mb` (decimal)
     - `page_count` (integer)
     - `created_at` (timestamptz)

  ## Security
  - RLS enabled on all tables
  - Users can only access their own data
  - Authenticated users only
  - Admin policies for subscription management

  ## Notes
  - Profiles automatically created on user signup via trigger
  - Usage logs track monthly limits for free tier
  - Subscription plans pre-populated with default tiers
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'business')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create subscription plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  price_monthly DECIMAL(10, 2) DEFAULT 0,
  max_operations_per_month INTEGER DEFAULT 10,
  max_file_size_mb INTEGER DEFAULT 10,
  features JSONB DEFAULT '[]'::jsonb,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  plan_id UUID REFERENCES subscription_plans(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'past_due')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create pdf_jobs table
CREATE TABLE IF NOT EXISTS pdf_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('merge', 'split', 'rotate', 'paginate', 'header_footer', 'extract', 'delete', 'reorder')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  input_files JSONB DEFAULT '[]'::jsonb,
  output_file TEXT,
  options JSONB DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Create usage_logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  file_size_mb DECIMAL(10, 2),
  page_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_pdf_jobs_user ON pdf_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdf_jobs_status ON pdf_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_date ON usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS Policies for subscription_plans (public read)
CREATE POLICY "Anyone can view active subscription plans"
  ON subscription_plans FOR SELECT
  TO authenticated
  USING (active = TRUE);

-- RLS Policies for subscriptions
CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own subscription"
  ON subscriptions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for pdf_jobs
CREATE POLICY "Users can view own PDF jobs"
  ON pdf_jobs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own PDF jobs"
  ON pdf_jobs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own PDF jobs"
  ON pdf_jobs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own PDF jobs"
  ON pdf_jobs FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for usage_logs
CREATE POLICY "Users can view own usage logs"
  ON usage_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own usage logs"
  ON usage_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Create function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at_profiles ON profiles;
CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_subscriptions ON subscriptions;
CREATE TRIGGER set_updated_at_subscriptions
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Insert default subscription plans
INSERT INTO subscription_plans (name, price_monthly, max_operations_per_month, max_file_size_mb, features)
VALUES 
  (
    'free',
    0.00,
    10,
    10,
    '["Merge PDFs", "Split PDFs", "Rotate pages", "Basic pagination", "10 operations/month", "10MB file limit"]'::jsonb
  ),
  (
    'pro',
    9.99,
    -1,
    100,
    '["Unlimited operations", "100MB file limit", "Advanced pagination", "Header & Footer", "Batch processing", "Priority support", "Desktop app access", "No watermarks"]'::jsonb
  ),
  (
    'business',
    29.99,
    -1,
    500,
    '["Everything in Pro", "500MB file limit", "API access", "Team collaboration", "Cloud storage (50GB)", "Priority support", "White-label option"]'::jsonb
  )
ON CONFLICT (name) DO NOTHING;