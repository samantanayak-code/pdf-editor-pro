# AI Search Troubleshooting Guide

## The Problem: "Search failed: Search failed"

You're seeing this error because the AI search feature has **three issues** that need to be resolved:

### Issue 1: Missing OpenAI API Key ⚠️
The AI semantic search uses OpenAI's embedding model to understand the meaning of your documents. Without an API key configured in Supabase, the search cannot work.

### Issue 2: Missing Vector Embeddings ⚠️
Your database has 528 text chunks from uploaded PDFs, but **zero have AI embeddings**. Without embeddings, semantic search has nothing to search against.

### Issue 3: Code Bugs (NOW FIXED ✅)
The edge functions were incorrectly converting vector arrays to JSON strings, causing database type mismatches. This has been fixed and redeployed.

---

## How to Fix It

### Step 1: Configure OpenAI API Key (5 minutes)

**Why**: The AI search uses OpenAI's text-embedding-3-small model to convert text into vectors for similarity search.

**How to get an API key:**

1. Visit https://platform.openai.com/api-keys
2. Sign up or log in to your account
3. Click "Create new secret key"
4. Give it a name like "PDF Editor Pro"
5. Copy the key (it starts with `sk-` and looks like `sk-...`)
6. **Save it immediately** - you won't see it again!

**How to add it to Supabase:**

1. Go to https://supabase.com/dashboard
2. Select your project
3. Click **Project Settings** (gear icon in sidebar)
4. Click **Edge Functions** in the left menu
5. Scroll down to **Secrets** section
6. Click **Add Secret**
7. Enter:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: Your API key (paste it)
8. Click **Save**

**Cost**: OpenAI embeddings are extremely cheap:
- Model: text-embedding-3-small
- Cost: $0.020 per 1 million tokens
- Your 128-page document: ~$0.003 (less than 1 cent)
- Typical monthly usage: Under $1

### Step 2: Generate AI Embeddings (30 seconds)

Your uploaded FIDIC document needs AI embeddings generated.

**Option A: Use the Regenerate Button (Easiest)**

1. Open your application
2. Go to the **AI Search** tab
3. Scroll down to **Your Documents** section
4. Find "FIDIC Condition of Contract (General Conditions) (1).pdf"
5. Click the **circular refresh icon** (🔄) next to it
6. Wait 20-40 seconds (it's a 128-page document)
7. You'll see: "Successfully indexed XXX chunks"

**Option B: Re-upload the Document**

1. Download the PDF from the app first (if you don't have it locally)
2. Delete it from the document list (trash icon)
3. Click "Upload PDF" and select the file
4. Wait for upload and automatic indexing

### Step 3: Test the Search

1. Enter a search query, for example:
   - `what is engineer's duty as per cl 3`
   - `payment terms`
   - `contract termination clauses`

2. Click **Search**

3. You should now see:
   - Results ranked by AI similarity score
   - Percentage match for each result
   - Page numbers and highlighted excerpts
   - Citation information

---

## What Was Fixed (Technical Details)

### Before (Broken)

**generate-embeddings function**:
```typescript
embedding: JSON.stringify(update.embedding)  // ❌ Wrong - converts array to string
```

**semantic-search function**:
```typescript
query_embedding: JSON.stringify(queryEmbedding)  // ❌ Wrong - converts array to string
```

**Result**: PostgreSQL's `vector` type received strings instead of arrays, causing type mismatch errors.

### After (Fixed)

**generate-embeddings function**:
```typescript
embedding: update.embedding  // ✅ Correct - passes raw array
```

**semantic-search function**:
```typescript
query_embedding: queryEmbedding  // ✅ Correct - passes raw array
```

**Result**: PostgreSQL receives proper vector arrays and can perform similarity search.

---

## Verification Steps

Use this checklist to confirm everything is working:

- [ ] OpenAI API key added to Supabase secrets
- [ ] Clicked regenerate button for FIDIC document
- [ ] Saw "Successfully indexed XXX chunks" message
- [ ] Entered search query
- [ ] Clicked Search button
- [ ] Results appeared with similarity percentages
- [ ] Results show correct page numbers
- [ ] Text excerpts displayed correctly

---

## Database Status Check

To verify embeddings were generated, you can run this SQL query in Supabase SQL Editor:

```sql
SELECT
  COUNT(*) as total_chunks,
  COUNT(embedding) as chunks_with_embeddings,
  COUNT(*) FILTER (WHERE processed = true) as processed_chunks,
  pg_size_pretty(pg_total_relation_size('pdf_chunks')) as table_size
FROM pdf_chunks;
```

**Before Fix**:
```
total_chunks: 528
chunks_with_embeddings: 0
processed_chunks: 0
```

**After Fix** (expected):
```
total_chunks: 528
chunks_with_embeddings: 528
processed_chunks: 528
```

---

## Common Errors and Solutions

### "OpenAI API key not configured"
**Cause**: API key not added to Supabase Edge Functions.
**Fix**: Follow Step 1 above.

### "Search failed: Search failed"
**Causes**:
1. No OpenAI API key configured
2. No embeddings generated
3. Network/connectivity issues

**Fixes**:
1. Add API key (Step 1)
2. Regenerate embeddings (Step 2)
3. Check browser console for detailed errors

### "No results found"
**Causes**:
1. Embeddings not generated yet
2. Query doesn't match document content
3. Match threshold too strict

**Fixes**:
1. Click regenerate button
2. Try different search terms
3. Wait a few seconds after regeneration

### Regenerate Button Does Nothing
**Causes**:
1. OpenAI API key not configured
2. Browser console has JavaScript errors
3. Network connectivity issues

**Fixes**:
1. Open browser console (F12 > Console tab)
2. Look for error messages
3. Check Supabase Edge Function logs
4. Verify API key is configured

---

## How AI Semantic Search Works

### Traditional Keyword Search
```
Query: "engineer's duty"
Finds: Exact matches for "engineer" AND "duty"
Misses: "engineer's responsibility", "engineer shall", "obligations of engineer"
```

### AI Semantic Search
```
Query: "engineer's duty"
Process:
  1. OpenAI converts query to 1536-dimension vector
  2. Database compares with all chunk vectors
  3. Returns chunks with highest similarity

Finds:
  - "engineer's responsibilities"
  - "engineer shall perform"
  - "obligations of the engineer"
  - "engineer's role and duties"
  - "duties assigned to engineer"

Ranks by semantic similarity (0-100%)
```

### The Architecture

```
PDF Upload → Text Extraction → Chunking → OpenAI Embeddings → Database Storage
                                                                      ↓
User Search Query → OpenAI Embedding → Vector Similarity Search ← Database
                                                ↓
                                    Ranked Results → UI Display
```

---

## Edge Function Logs (For Debugging)

To check what's happening:

1. Go to Supabase Dashboard
2. Navigate to **Edge Functions**
3. Click on function name:
   - `generate-embeddings` (for indexing issues)
   - `semantic-search` (for search issues)
4. Click **Logs** tab
5. Look for error messages

**Common log entries**:

✅ **Success**:
```
Embeddings generated successfully
Processed: 528 chunks
```

❌ **Error - No API Key**:
```
Error: OpenAI API key not configured
```

❌ **Error - Auth Issues**:
```
Error: Unauthorized
```

---

## Performance Expectations

### Embedding Generation Time
- **10 pages**: 3-5 seconds
- **50 pages**: 10-15 seconds
- **128 pages** (your FIDIC doc): 20-40 seconds
- **500 pages**: 2-3 minutes

### Search Time
- **Query processing**: 0.5-1 second
- **Database search**: 0.2-0.5 seconds
- **Total**: 1-2 seconds per search

### Storage Requirements
- **Text chunk**: ~800 bytes
- **Vector embedding**: ~6KB per chunk
- **Your document**: 528 chunks × 6KB = ~3MB

---

## Cost Calculator

### OpenAI API Costs

**Model**: text-embedding-3-small
**Price**: $0.020 per 1M tokens

**Your Document (128 pages)**:
- Tokens: ~128,000
- Cost: $0.0026

**Monthly Usage Examples**:
- 100 pages uploaded: $0.002
- 1,000 pages uploaded: $0.020
- 10,000 pages uploaded: $0.200

**Search Queries** (per 1,000 searches):
- Cost: $0.001 (essentially free)

### Supabase Costs
- **Free tier**: 500MB database, 1GB storage
- **Database usage**: ~3MB per 128-page doc
- **You can store**: ~150 documents like yours in free tier

---

## Next Steps

1. **Immediate**: Add OpenAI API key (Step 1)
2. **Then**: Regenerate embeddings (Step 2)
3. **Finally**: Test search (Step 3)

**Total time**: Less than 10 minutes

After these steps, your AI-powered semantic search will be fully functional!

---

## Support Resources

- **OpenAI Documentation**: https://platform.openai.com/docs
- **Supabase Documentation**: https://supabase.com/docs
- **pgvector Documentation**: https://github.com/pgvector/pgvector

For specific issues, check:
- Browser console errors (F12 > Console)
- Supabase Edge Function logs
- Database query results (SQL Editor)
