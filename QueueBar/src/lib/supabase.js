import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// URL: https://awwmfsjsrjktekmbgadx.supabase.co (set in .env, never committed)
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }
);

const REPORT_TTL_MS = 45 * 60 * 1000;
const SPAM_WINDOW_MS = 20 * 60 * 1000;
const POINTS_PER_REPORT = 10;

// Reports that have not expired yet, newest first.
export async function loadReports() {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('loadReports failed', error.message);
    return [];
  }
  return data ?? [];
}

// Calls callback on any change to reports. Returns { unsubscribe }.
export function subscribeToReports(callback) {
  const channel = supabase
    .channel('reports-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, callback)
    .subscribe();
  return { unsubscribe: () => supabase.removeChannel(channel) };
}

export async function submitReport({ venueId, venueName, queueStatus, userId }) {
  const now = Date.now();

  const { data: recent, error: recentError } = await supabase
    .from('reports')
    .select('created_at')
    .eq('user_id', userId)
    .gt('created_at', new Date(now - SPAM_WINDOW_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (recentError) throw recentError;
  if (recent?.length) {
    const waitMinutes = Math.max(
      1,
      Math.ceil((new Date(recent[0].created_at).getTime() + SPAM_WINDOW_MS - now) / 60000)
    );
    const err = new Error(`Vänta ${waitMinutes} minuter innan nästa rapport`);
    err.code = 'SPAM';
    err.waitMinutes = waitMinutes;
    throw err;
  }

  const { error } = await supabase.from('reports').insert({
    venue_id: venueId,
    venue_name: venueName,
    queue_status: queueStatus,
    user_id: userId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + REPORT_TTL_MS).toISOString(),
  });
  if (error) throw error;

  const { error: rpcError } = await supabase.rpc('increment_points', {
    p_user_id: userId,
    p_points: POINTS_PER_REPORT,
  });
  if (rpcError) console.warn('increment_points failed', rpcError.message);
}

// Returns true if the venue is now a favorite, false if it was removed.
export async function toggleFavorite(venueId, userId) {
  const { data, error } = await supabase
    .from('favorites')
    .select('venue_id')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) throw error;

  if (data) {
    const { error: delError } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('venue_id', venueId);
    if (delError) throw delError;
    return false;
  }
  const { error: insError } = await supabase
    .from('favorites')
    .insert({ user_id: userId, venue_id: venueId });
  if (insError) throw insError;
  return true;
}

// Array of favorite venue ids.
export async function loadFavorites(userId) {
  const { data, error } = await supabase
    .from('favorites')
    .select('venue_id')
    .eq('user_id', userId);
  if (error) {
    console.warn('loadFavorites failed', error.message);
    return [];
  }
  return (data ?? []).map(f => f.venue_id);
}

export async function deleteAllUserData(userId) {
  for (const table of ['reports', 'favorites', 'user_profiles']) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) throw error;
  }
}

// Profile row for stats: { points, created_at } (or null).
export async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('loadProfile failed', error.message);
    return null;
  }
  return data;
}

// The user's own reports (including expired ones), newest first.
export async function loadUserReports(userId) {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('loadUserReports failed', error.message);
    return [];
  }
  return data ?? [];
}
