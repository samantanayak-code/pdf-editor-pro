/*
  # Update Subscription Plans to Free Unlimited

  ## Changes
  Updates the free tier to have unlimited operations for customer feedback phase.
  All users will have unlimited access to all features.

  ## Notes
  - Free tier now has -1 (unlimited) operations per month
  - File size limit increased to 100MB for free tier
  - Can be reverted later when monetizing
*/

UPDATE subscription_plans
SET 
  max_operations_per_month = -1,
  max_file_size_mb = 100,
  features = '["Unlimited operations", "100MB file limit", "Merge PDFs", "Split PDFs", "Rotate pages", "Page numbering", "Header & Footer", "AI Search & Citations", "All features included"]'::jsonb
WHERE name = 'free';
