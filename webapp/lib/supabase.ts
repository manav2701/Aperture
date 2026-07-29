import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
  console.error('[Aperture] NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local or Vercel Environment Variables.');
}

if (!supabaseAnonKey || supabaseAnonKey.includes('placeholder')) {
  console.error('[Aperture] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Add it to .env.local or Vercel Environment Variables.');
}

export const supabase = createClient(
  supabaseUrl || 'https://fkvoweryeifabfebzsos.supabase.co',
  supabaseAnonKey || ''
);

export const getServerSupabase = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fkvoweryeifabfebzsos.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient(url, key);
};