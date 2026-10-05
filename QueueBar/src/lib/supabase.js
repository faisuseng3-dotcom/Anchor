import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }
);

const REPORT_WINDOW_MS = 2 * 60 * 60 * 1000; // only recent reports count

export async function loadReports() {
  const since = new Date(Date.now() - REPORT_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('loadReports failed', error.message);
    return [];
  }
  return data ?? [];
}

// Calls onChange on any insert/update/delete. Returns { unsubscribe }.
export function subscribeToReports(onChange) {
  const channel = supabase
    .channel('reports-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, onChange)
    .subscribe();
  return { unsubscribe: () => supabase.removeChannel(channel) };
}
