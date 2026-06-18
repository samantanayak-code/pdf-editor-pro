// Feature flags for enabling/disabling application features
// This allows you to control which features are available without modifying the .env file

export const FEATURES = {
  // AI Search - Requires OpenAI API key (paid feature)
  // Set to false to completely disable AI search functionality
  AI_SEARCH_ENABLED: false,

  // Pro Editor - Advanced PDF editing with inline text editing
  PRO_EDITOR_ENABLED: true,

  // Basic Editor - Simple PDF operations (merge, rotate, split, etc.)
  BASIC_EDITOR_ENABLED: true,

  // Converter - Convert PDFs to Word/Excel
  CONVERTER_ENABLED: true,

  // Dashboard - Usage statistics and analytics
  DASHBOARD_ENABLED: true,
} as const;

// Helper to check if a feature is enabled
export function isFeatureEnabled(feature: keyof typeof FEATURES): boolean {
  return FEATURES[feature];
}
