/*
  # Backfill Missing User Profiles

  ## Changes Made
  
  1. Create profiles for all existing auth users who don't have profiles
  2. This fixes foreign key constraint violations when users try to upload PDFs
  
  ## Notes
  - Handles users who signed up before the profile trigger was created
  - Safe to run multiple times (uses INSERT ... ON CONFLICT DO NOTHING)
*/

-- Create profiles for all existing auth users without profiles
INSERT INTO profiles (id, email, full_name, subscription_tier, created_at, updated_at)
SELECT 
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', ''),
  'free',
  u.created_at,
  NOW()
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
