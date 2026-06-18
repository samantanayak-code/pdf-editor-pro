import { supabase } from './supabase';

export async function checkUsageLimit(userId: string): Promise<{
  allowed: boolean;
  currentUsage: number;
  limit: number;
  tier: string;
}> {
  console.log('Usage check: All tiers unlimited, allowing operation');
  return { allowed: true, currentUsage: 0, limit: -1, tier: 'free' };
}

export async function logUsage(
  userId: string,
  operation: string,
  fileSizeMB: number,
  pageCount: number
): Promise<void> {
  try {
    await supabase.from('usage_logs').insert({
      user_id: userId,
      operation,
      file_size_mb: fileSizeMB,
      page_count: pageCount,
    });
  } catch (error) {
    console.error('Error logging usage:', error);
  }
}

export async function getUsageStats(userId: string): Promise<{
  totalOperations: number;
  operationsThisMonth: number;
  operationsByType: Record<string, number>;
  limit: number;
  tier: string;
}> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle();

    const tier = profile?.subscription_tier || 'free';

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('max_operations_per_month')
      .eq('name', tier)
      .maybeSingle();

    const limit = plan?.max_operations_per_month || 10;

    const { data: allLogs } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const totalOperations = allLogs?.length || 0;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const monthLogs = allLogs?.filter(
      (log) => new Date(log.created_at) >= thirtyDaysAgo
    ) || [];

    const operationsThisMonth = monthLogs.length;

    const operationsByType = monthLogs.reduce((acc, log) => {
      acc[log.operation] = (acc[log.operation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalOperations,
      operationsThisMonth,
      operationsByType,
      limit,
      tier,
    };
  } catch (error) {
    console.error('Error getting usage stats:', error);
    return {
      totalOperations: 0,
      operationsThisMonth: 0,
      operationsByType: {},
      limit: 10,
      tier: 'free',
    };
  }
}
