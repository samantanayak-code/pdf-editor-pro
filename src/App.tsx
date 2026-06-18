import { useState } from 'react';
import { useAuth } from './lib/auth';
import { PDFEditorPro } from './components/PDFEditorPro';
import { Dashboard } from './components/Dashboard';
import { PDFSearch } from './components/PDFSearch';
import PDFConverter from './components/PDFConverter';
import { AuthModal } from './components/AuthModal';
import { ToastContainer, useToast } from './components/Toast';
import { FileText, LogOut, User } from 'lucide-react';
import { FEATURES } from './config/features';

function App() {
  const { user, profile, signOut, loading } = useAuth();
  const [activeView, setActiveView] = useState<'editor' | 'dashboard' | 'search' | 'converter'>('editor');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-500 font-medium">Initializing Editor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">PDF Editor Pro</h1>
          </div>

          <div className="hidden md:flex items-center gap-1">
            <button
              onClick={() => setActiveView('editor')}
              className={`px-4 py-2 rounded-lg transition-all font-medium ${
                activeView === 'editor'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Editor
            </button>
            {FEATURES.CONVERTER_ENABLED && (
              <button
                onClick={() => setActiveView('converter')}
                className={`px-4 py-2 rounded-lg transition-all font-medium ${
                  activeView === 'converter'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Converter
              </button>
            )}
            {FEATURES.AI_SEARCH_ENABLED && user && (
              <button
                onClick={() => setActiveView('search')}
                className={`px-4 py-2 rounded-lg transition-all font-medium ${
                  activeView === 'search'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                AI Search
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full border border-gray-200">
                  <User className="w-4 h-4 text-gray-600" />
                  <span className="text-sm font-semibold text-gray-700">
                    {profile?.full_name || user.email}
                  </span>
                </div>
                <button
                  onClick={signOut}
                  className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAuthModalOpen(true)}
                className="px-5 py-2 bg-gray-900 text-white rounded-lg font-semibold hover:bg-black transition-all shadow-sm"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-hidden flex flex-col">
        {activeView === 'editor' ? (
          <PDFEditorPro onToast={addToast} />
        ) : activeView === 'converter' ? (
          <div className="p-8 max-w-7xl mx-auto w-full overflow-auto"><PDFConverter /></div>
        ) : activeView === 'search' ? (
          <div className="p-8 max-w-7xl mx-auto w-full overflow-auto"><PDFSearch onToast={addToast} /></div>
        ) : (
          <div className="p-8 max-w-7xl mx-auto w-full overflow-auto"><Dashboard /></div>
        )}
      </main>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => {
          addToast('Successfully signed in!', 'success');
        }}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

export default App;
