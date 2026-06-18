# OpenAI API Setup for AI Search

## ⚠️ IMPORTANT: This is Required for AI Search to Work

If you're seeing the error **"Index generation failed: Failed to generate index"**, it means the OpenAI API key hasn't been configured yet. This is a required step.

## Why You Need This

The AI-powered semantic search feature uses OpenAI's embedding model to understand the meaning of your documents and search queries. This enables intelligent search that finds relevant content even when you don't use the exact keywords.

## Quick Setup Steps

### 1. Get Your OpenAI API Key

1. Go to https://platform.openai.com/
2. Sign up or log in to your account
3. Navigate to https://platform.openai.com/api-keys
4. Click "Create new secret key"
5. Give it a name (e.g., "PDF Editor Pro")
6. Copy the key immediately (you won't see it again)

### 2. Add the Key to Supabase

1. Open your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Go to **Project Settings** (gear icon in sidebar)
4. Click on **Edge Functions** in the left menu
5. Scroll to **Secrets** section
6. Click **Add Secret**
7. Enter:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: Paste your OpenAI API key
8. Click **Save**

### 3. Verify It Works

1. Go to your application
2. Upload a PDF in the AI Search section
3. Wait for "AI indexing in progress..." message
4. Try searching for content in the document
5. You should see ranked results with similarity scores

## Cost Estimate

OpenAI charges for embedding generation based on tokens processed:

- **Model**: text-embedding-3-small
- **Cost**: $0.020 per 1 million tokens
- **Average**: ~1,000 tokens per page

### Example Costs
- 10-page document: ~$0.0002 (basically free)
- 100-page document: ~$0.002
- 1,000 pages total: ~$0.02

For most users, this costs less than $1/month.

## What If I Don't Set This Up?

Without the OpenAI API key:
- ✅ PDF editing features work perfectly (merge, rotate, etc.)
- ✅ Document upload works
- ❌ AI semantic search won't work
- ❌ Embeddings won't be generated

The application won't crash - it will just log errors in the background and the AI search feature won't return results.

## Alternative: Basic Keyword Search

If you don't want to use OpenAI, you can implement a basic keyword search instead by modifying the `searchPDFContent` function to use PostgreSQL full-text search. However, this won't have the intelligence of semantic search.

## Security Note

Your OpenAI API key is stored securely in Supabase as a secret environment variable. It's never exposed to the frontend or in your code repository. Only your Edge Functions can access it.

## Troubleshooting

### Error: "Index generation failed"

This error appears when:
1. The OpenAI API key is not configured in Supabase Edge Functions secrets
2. The API key is incorrect or has been revoked
3. You don't have credits in your OpenAI account

**Solution:**
1. Follow steps 1-2 above to add your API key
2. Verify the key is correct (should start with `sk-`)
3. Check your OpenAI account has available credits
4. After adding the key, click the refresh icon (🔄) next to your document again

### Error: "Search failed"

This means the embeddings haven't been generated yet:
1. Look for documents with **"AI Index Needed"** badge
2. Click the pulsing refresh icon (🔄) next to each document
3. Wait 1-2 minutes for processing
4. Look for the green **"✓ Ready"** badge
5. Now you can search

### How to Check if It's Working

1. Upload a PDF document
2. Click the refresh icon (🔄) - you should see: "Generating AI index... This may take a minute"
3. After processing: "Successfully indexed X chunks! You can now search this document"
4. The document badge changes from orange "AI Index Needed" to green "✓ Ready"
5. Try searching - you should see ranked results with similarity percentages

## Need Help?

- OpenAI Documentation: https://platform.openai.com/docs
- Supabase Secrets Guide: https://supabase.com/docs/guides/functions/secrets
- OpenAI Pricing: https://openai.com/api/pricing/
