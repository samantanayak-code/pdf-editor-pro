# Feature Configuration Guide

## Overview

Your PDF Editor Pro application now has a centralized feature configuration system that allows you to easily enable or disable features without modifying multiple files or environment variables.

## Configuration File Location

```
src/config/features.ts
```

## How to Enable/Disable Features

Open `src/config/features.ts` and change the boolean values:

```typescript
export const FEATURES = {
  // AI Search - Requires OpenAI API key (paid feature)
  AI_SEARCH_ENABLED: false,  // ← Change to true to enable

  // Pro Editor - Advanced PDF editing with inline text editing
  PRO_EDITOR_ENABLED: true,

  // Basic Editor - Simple PDF operations (merge, rotate, split, etc.)
  BASIC_EDITOR_ENABLED: true,

  // Converter - Convert PDFs to Word/Excel
  CONVERTER_ENABLED: true,

  // Dashboard - Usage statistics and analytics
  DASHBOARD_ENABLED: true,
} as const;
```

## Feature Details

### 1. AI Search (`AI_SEARCH_ENABLED`)

**What it does:**
- Semantic search across PDF documents
- Uses OpenAI embeddings for intelligent search
- Provides ranked results with similarity scores
- Shows page citations and context

**Requirements:**
- OpenAI API key (paid service)
- Supabase Edge Functions configured with secret
- Database tables: `pdf_documents`, `pdf_chunks`, `search_history`

**Cost:**
- ~$0.020 per 1 million tokens
- Average: $0.002 per 100-page document
- Typical usage: <$1/month for most users

**When disabled:**
- AI Search button removed from navigation
- No API calls to OpenAI
- No embedding generation
- No cost incurred
- Database tables remain but unused

**Performance impact when disabled:**
- ✅ **Zero impact** - feature completely removed from UI
- ✅ No API calls made
- ✅ No background processes
- ✅ Smaller bundle size (minimal)

### 2. Pro Editor (`PRO_EDITOR_ENABLED`)

**What it does:**
- Advanced inline text editing
- Pixel-perfect layout preservation
- Real-time preview
- Text formatting (bold, italic, underline)
- Professional export quality

**Requirements:**
- None (all client-side)

**Cost:** Free

**When disabled:**
- Pro Editor button removed
- Users can still use Basic Editor

### 3. Basic Editor (`BASIC_EDITOR_ENABLED`)

**What it does:**
- Merge PDFs
- Split PDFs
- Rotate pages
- Delete pages
- Reorder pages
- Add headers/footers

**Requirements:**
- None (all client-side)

**Cost:** Free

### 4. Converter (`CONVERTER_ENABLED`)

**What it does:**
- Convert PDF to Word (DOCX)
- Extract tables to Excel (XLSX)
- Client-side processing

**Requirements:**
- None (all client-side)

**Cost:** Free

### 5. Dashboard (`DASHBOARD_ENABLED`)

**What it does:**
- Usage statistics
- Operations tracking
- Subscription tier display
- Monthly limits

**Requirements:**
- Database tables: `profiles`, `usage_logs`

**Cost:** Free (Supabase free tier)

## Common Scenarios

### Scenario 1: Disable AI Search (No OpenAI API Key)

**Reason:** You don't want to pay for OpenAI API or don't need semantic search.

**Steps:**
1. Open `src/config/features.ts`
2. Change `AI_SEARCH_ENABLED: false`
3. Run `npm run build`
4. Deploy

**Result:**
- ✅ No AI Search button in navigation
- ✅ No OpenAI API calls
- ✅ No costs
- ✅ All other features work perfectly
- ✅ No performance impact

### Scenario 2: Keep Only Pro Editor

**Reason:** You only want the advanced editing features.

**Steps:**
```typescript
export const FEATURES = {
  AI_SEARCH_ENABLED: false,
  PRO_EDITOR_ENABLED: true,
  BASIC_EDITOR_ENABLED: false,
  CONVERTER_ENABLED: false,
  DASHBOARD_ENABLED: false,
};
```

**Result:**
- Clean, focused interface
- Only Pro Editor visible
- Minimal bundle size

### Scenario 3: Enable Everything (Full Featured)

**Reason:** You have OpenAI API key and want all features.

**Steps:**
```typescript
export const FEATURES = {
  AI_SEARCH_ENABLED: true,  // Requires OpenAI API key
  PRO_EDITOR_ENABLED: true,
  BASIC_EDITOR_ENABLED: true,
  CONVERTER_ENABLED: true,
  DASHBOARD_ENABLED: true,
};
```

**Requirements:**
1. Configure OpenAI API key in Supabase (see OPENAI_SETUP.md)
2. Deploy Edge Functions
3. Verify database migrations

## Performance Comparison

### AI Search Disabled vs Enabled

| Metric | Disabled | Enabled |
|--------|----------|---------|
| Initial Load | Same | Same |
| Bundle Size | Slightly smaller | Standard |
| API Calls | 0 | Only when searching |
| Database Queries | Standard | + search queries |
| Monthly Cost | $0 | <$1 (OpenAI) |

### Key Points:
- ✅ Disabling AI Search has **no negative performance impact**
- ✅ All other features work exactly the same
- ✅ No background processes or hidden API calls
- ✅ Feature is completely removed from the application

## Deployment Steps

After changing feature flags:

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Verify the build:**
   - Check that build completes successfully
   - No TypeScript errors
   - Bundle size is reasonable

3. **Test locally (optional):**
   ```bash
   npm run preview
   ```

4. **Deploy:**
   - Push to your repository
   - Deployment service (Vercel, Netlify, etc.) will auto-deploy
   - Or manually deploy the `dist` folder

## Frequently Asked Questions

### Q: Does disabling AI Search break the app?
**A:** No. The feature is completely optional and isolated. All other features work perfectly without it.

### Q: Can I enable AI Search later?
**A:** Yes. Just change `AI_SEARCH_ENABLED: true`, get an OpenAI API key, configure it in Supabase, and deploy.

### Q: Do I need to modify the database if I disable AI Search?
**A:** No. The database tables remain but are simply unused. No cleanup needed.

### Q: Will users see error messages if AI Search is disabled?
**A:** No. The feature is completely removed from the UI. Users won't see the button or any related functionality.

### Q: Can I customize which users see which features?
**A:** Currently, features are global (all users see the same features). To add per-user feature flags, you'd need to:
1. Add feature flags to the `profiles` table
2. Check user profile in `features.ts`
3. Return user-specific feature flags

### Q: How much does it cost to keep AI Search disabled?
**A:** $0. When disabled, no API calls are made to OpenAI.

### Q: What if I accidentally enable AI Search without configuring OpenAI?
**A:** The app will work, but users will see error messages when trying to index documents. They can still use all other features.

## Technical Details

### How Feature Flags Work

1. **Configuration File:** `src/config/features.ts` exports a `FEATURES` object
2. **Import in Components:** Components import and check `FEATURES.AI_SEARCH_ENABLED`
3. **Conditional Rendering:** UI elements wrapped in conditionals:
   ```typescript
   {FEATURES.AI_SEARCH_ENABLED && (
     <button>AI Search</button>
   )}
   ```
4. **Tree Shaking:** When features are disabled, bundler can remove unused code

### Files Modified for Feature Flags

- `src/config/features.ts` - Configuration file (NEW)
- `src/App.tsx` - Main app with conditional feature rendering

### Database Impact

When AI Search is disabled:
- ✅ Tables exist but unused: `pdf_documents`, `pdf_chunks`, `search_history`
- ✅ Edge Functions exist but not called
- ✅ No queries executed
- ✅ No storage used

You can optionally clean up by:
1. Deleting the Edge Functions (optional)
2. Dropping the tables (optional)
3. Removing the migrations (optional)

**However, it's safe to leave them.** They consume no resources when unused.

## Summary

The feature flag system allows you to:
1. ✅ Easily disable AI Search to avoid OpenAI costs
2. ✅ Keep all other features working perfectly
3. ✅ No performance impact when features are disabled
4. ✅ Clean, simple configuration in one file
5. ✅ Enable features later without code changes

**Bottom Line:** You can safely disable AI Search and run the entire application for free using only Supabase's free tier!
