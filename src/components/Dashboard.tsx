import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getUsageStats } from '../lib/usage';
import { FileText, Calendar, Crown } from 'lucide-react';

export function Dashboard() {
  const { user, profile } = useAuth();
  const [stats, setStats] = useState({
    totalOperations: 0,
    operationsThisMonth: 0,
    operationsByType: {} as Record<string, number>,
    limit: 10,
    tier: 'free',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadStats();
    }
  }, [user]);

  const loadStats = async () => {
    if (!user) return;

    try {
      const data = await getUsageStats(user.id);
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  const usagePercentage = stats.limit === -1
    ? 0
    : (stats.operationsThisMonth / stats.limit) * 100;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-gray-600">
          Welcome back, {profile?.full_name || user?.email}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border-2 border-blue-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600 rounded-lg">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-blue-700">Total Operations</p>
              <p className="text-2xl font-bold text-blue-900">
                {stats.totalOperations}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border-2 border-green-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-600 rounded-lg">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-green-700">This Month</p>
              <p className="text-2xl font-bold text-green-900">
                {stats.operationsThisMonth}
                {stats.limit !== -1 && (
                  <span className="text-sm text-green-700"> / {stats.limit}</span>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-6 border-2 border-amber-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-600 rounded-lg">
              <Crown className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-amber-700">Subscription</p>
              <p className="text-2xl font-bold text-amber-900 capitalize">
                {stats.tier}
              </p>
            </div>
          </div>
        </div>
      </div>

      {stats.limit !== -1 && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Monthly Usage
            </h2>
            <span className="text-sm text-gray-600">
              {stats.operationsThisMonth} / {stats.limit} operations
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                usagePercentage >= 90
                  ? 'bg-red-500'
                  : usagePercentage >= 70
                  ? 'bg-amber-500'
                  : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(usagePercentage, 100)}%` }}
            ></div>
          </div>
          {usagePercentage >= 80 && (
            <p className="mt-3 text-sm text-amber-700">
              You're approaching your monthly limit. Consider upgrading to Pro for unlimited operations.
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Operations Breakdown
        </h2>
        {Object.keys(stats.operationsByType).length > 0 ? (
          <div className="space-y-3">
            {Object.entries(stats.operationsByType).map(([operation, count]) => (
              <div key={operation} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-gray-700 capitalize">{operation}</span>
                </div>
                <span className="font-semibold text-gray-900">{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">
            No operations yet. Start by uploading a PDF!
          </p>
        )}
      </div>

      {stats.tier === 'free' && (
        <div className="mt-8 bg-gradient-to-r from-green-600 to-green-700 rounded-xl p-8 text-white">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-2xl font-bold mb-2">All Features Free!</h3>
              <p className="text-green-100 mb-4">
                We're collecting feedback before monetization. Enjoy unlimited access to all features!
              </p>
              <ul className="space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-xs">✓</span>
                  </div>
                  <span>Unlimited PDF operations</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-xs">✓</span>
                  </div>
                  <span>100MB file size limit</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-xs">✓</span>
                  </div>
                  <span>AI Search with citations</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-xs">✓</span>
                  </div>
                  <span>Header & Footer customization</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-xs">✓</span>
                  </div>
                  <span>PDF to Word & Excel conversion</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-xs">✓</span>
                  </div>
                  <span>All editing features included</span>
                </li>
              </ul>
              <p className="text-sm text-green-100">
                Help us improve by sharing your feedback!
              </p>
            </div>
            <Crown className="w-24 h-24 text-green-400 opacity-20" />
          </div>
        </div>
      )}
    </div>
  );
}
