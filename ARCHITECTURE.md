# PDF Editor Pro - Architecture Documentation

## System Overview

PDF Editor Pro is a production-ready SaaS application for PDF manipulation built as a hybrid solution supporting both web and desktop platforms (desktop implementation planned for Phase 2).

## Architecture Principles

### 1. Separation of Concerns

- **UI Layer** (`src/components/`): React components for user interface
- **Business Logic** (`src/lib/`): Core functionality independent of UI
- **PDF Engine** (`src/lib/pdf/`): PDF manipulation operations
- **Backend** (Supabase): Database, authentication, storage, and edge functions

### 2. Security-First Design

- Row Level Security (RLS) on all database tables
- User authentication required for all operations
- Input validation at multiple layers
- Secure file storage with access controls
- Usage tracking to prevent abuse

### 3. Scalability Considerations

- Client-side PDF processing reduces server load
- Edge functions for future server-side processing
- Usage tiers allow for business model scaling
- Modular architecture supports feature additions

## Component Architecture

### Authentication Flow

```
User → AuthModal → useAuth() → Supabase Auth
                              → Profile Creation (trigger)
                              → Session Management
```

### PDF Processing Flow

```
User Uploads → FileUpload Component → PDFEditor
                                    → Check Usage Limit
                                    → PDF Core Engine (client-side)
                                    → Download Result
                                    → Log Usage
```

### Data Flow

```
Component → Hook (useAuth, custom hooks)
         → Service Layer (lib/)
         → Supabase (database/storage)
         → Edge Functions (optional)
```

## Database Design

### Schema Relationships

```
auth.users (Supabase)
    ↓
profiles (1:1)
    ↓
├── subscriptions (1:1)
│       ↓
│   subscription_plans (N:1)
│
├── usage_logs (1:N)
│
└── pdf_jobs (1:N)
```

### Key Design Decisions

1. **profiles extends auth.users**: Keeps auth separate from business data
2. **Automatic profile creation**: Trigger on user signup for seamless onboarding
3. **Soft limits via subscription_tier**: Flexibility for future plan changes
4. **usage_logs for tracking**: Enables analytics and limit enforcement
5. **pdf_jobs for history**: Future feature for job queue and history

## Security Model

### Row Level Security Policies

All tables implement restrictive RLS:

```sql
-- Users can only see their own data
CREATE POLICY "Users view own data"
  ON table_name FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can only modify their own data
CREATE POLICY "Users modify own data"
  ON table_name FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

### Authentication

- Email/password via Supabase Auth
- JWT tokens for session management
- Automatic session refresh
- Secure password requirements (min 6 characters)

### File Storage

- Supabase Storage with public bucket for processed PDFs
- RLS policies on storage.objects
- File type validation (PDF only)
- Size limits based on subscription tier

## Performance Optimizations

### Client-Side Processing

All PDF operations run in the browser:

**Advantages:**
- Zero server processing cost
- Instant results (no upload/download)
- Privacy (files never leave user's device)
- Scales automatically with user base

**Trade-offs:**
- Limited by browser memory
- Slower on large files
- No background processing

### Future: Hybrid Processing

For Phase 2+, implement smart routing:

```typescript
if (fileSize > threshold || complexOperation) {
  // Use server-side processing via Edge Functions
  processOnServer(file, options);
} else {
  // Use client-side processing
  processLocally(file, options);
}
```

## Subscription Model Implementation

### Free Tier (Default)

- 10 operations per month
- 10 MB file size limit
- Basic features only
- No payment required

### Upgrade Path

1. User hits free tier limit
2. Dashboard shows upgrade prompt
3. User clicks "Upgrade to Pro"
4. Future: Redirect to Stripe Checkout
5. Webhook updates subscription_tier
6. Limits automatically lifted

### Enforcement

```typescript
// Before any operation
const usageCheck = await checkUsageLimit(userId);

if (!usageCheck.allowed) {
  throw new Error('Monthly limit reached. Please upgrade.');
}

// After successful operation
await logUsage(userId, operation, fileSizeMB, pageCount);
```

## Edge Functions Design

### Current Implementation

`process-pdf` edge function supports:
- merge
- rotate
- paginate
- delete
- extract

### Benefits of Edge Functions

1. **Offload processing**: For large files or complex operations
2. **Centralized logic**: Business rules in one place
3. **Background jobs**: Process async without blocking UI
4. **Rate limiting**: Server-side enforcement
5. **Analytics**: Centralized logging

### When to Use Edge Functions

- Files > 50 MB
- Batch operations (multiple files)
- Complex operations (OCR, compression)
- When client device is resource-constrained

## Electron Desktop App (Phase 2)

### Architecture

```
Electron Main Process (Node.js)
    ├── IPC Handlers
    ├── File System Access
    ├── PDF Processing (using pdf-lib directly)
    └── Auto-updater

Electron Renderer (Chromium)
    └── Same React App as Web
```

### Shared Code Strategy

```
src/lib/pdf/           ← Shared between web and desktop
src/components/        ← Shared React components
src/lib/electron.ts    ← Desktop-specific code
```

### Desktop Advantages

1. **No upload**: Direct file system access
2. **Larger files**: No browser memory limits
3. **Offline**: Full functionality without internet
4. **Native features**: System file dialogs, notifications
5. **Better performance**: Node.js for heavy processing

### Implementation Plan

1. Add Electron dependencies
2. Create main process entry point
3. Set up IPC communication
4. Implement platform detection in React app
5. Configure electron-builder
6. Set up auto-updates

## Monetization Strategy

### Revenue Model

1. **Freemium Subscription** (Primary)
   - Free: $0/month (10 ops)
   - Pro: $9.99/month (unlimited)
   - Business: $29.99/month (unlimited + API)

2. **Desktop License** (One-time)
   - $49.99 lifetime license
   - Includes all Pro features
   - Desktop app only

3. **API Access** (B2B)
   - $0.01 per operation
   - Volume discounts
   - Business tier or higher

### Payment Integration (Phase 2)

```typescript
// Stripe Checkout integration
const handleUpgrade = async (priceId: string) => {
  const response = await fetch('/api/create-checkout', {
    method: 'POST',
    body: JSON.stringify({ priceId }),
  });

  const { sessionId } = await response.json();
  await stripe.redirectToCheckout({ sessionId });
};

// Webhook handler for subscription updates
// Updates subscription_tier in profiles table
```

## Testing Strategy

### Unit Tests

- PDF engine functions
- Utility functions
- Hooks logic

### Integration Tests

- Authentication flow
- PDF operations end-to-end
- Usage tracking
- Subscription management

### E2E Tests

- User signup → upload → process → download
- Usage limit enforcement
- Dashboard statistics

## Deployment Architecture

### Production Setup

```
┌─────────────────────────────────────────┐
│   Vercel (Frontend + API Routes)        │
│   - React App                            │
│   - Serverless Functions                 │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│   Supabase Cloud                         │
│   - PostgreSQL Database                  │
│   - Authentication                       │
│   - Storage (PDF files)                  │
│   - Edge Functions                       │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│   Cloudflare CDN                         │
│   - Static assets                        │
│   - Global distribution                  │
└─────────────────────────────────────────┘
```

### Environment Variables

```bash
# .env (already configured)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx

# Production only
SUPABASE_SERVICE_ROLE_KEY=xxx
STRIPE_SECRET_KEY=xxx
STRIPE_WEBHOOK_SECRET=xxx
```

## Monitoring and Analytics

### Key Metrics to Track

1. **User Engagement**
   - Daily/Monthly Active Users
   - Operations per user
   - Feature usage distribution

2. **Performance**
   - PDF processing time
   - Error rates
   - API response times

3. **Business**
   - Conversion rate (free → paid)
   - Monthly Recurring Revenue (MRR)
   - Churn rate

### Tools

- Supabase Dashboard (database metrics)
- Vercel Analytics (web vitals)
- Sentry (error tracking)
- PostHog (product analytics)

## Security Checklist

- [x] RLS enabled on all tables
- [x] Input validation on file uploads
- [x] File type restrictions (PDF only)
- [x] Size limits based on tier
- [x] Authentication required for all operations
- [x] Secure password requirements
- [x] Usage limits to prevent abuse
- [ ] Rate limiting on API endpoints (Phase 2)
- [ ] CSRF protection (Phase 2)
- [ ] Content Security Policy (Phase 2)
- [ ] Regular dependency updates

## Future Enhancements

### Phase 2 (Weeks 7-10)

1. Electron desktop app
2. Advanced header/footer with logos
3. Undo/Redo functionality
4. Dark mode
5. Batch processing UI

### Phase 3 (Weeks 11-14)

1. OCR integration
2. PDF compression
3. Watermarks
4. Form filling
5. Stripe payment integration

### Phase 4 (Months 5-6)

1. Digital signatures
2. Cloud storage integration
3. Collaboration features
4. Mobile app (React Native)
5. API for developers

## Conclusion

This architecture provides a solid foundation for a production-ready PDF SaaS application. The modular design allows for incremental feature additions while maintaining code quality and security.

Key strengths:
- Scalable client-side processing
- Secure authentication and data access
- Clear separation of concerns
- Flexible subscription model
- Ready for monetization

The codebase is ready for production deployment and can be extended with additional features as needed.
