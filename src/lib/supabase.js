import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('ARCHIVE WARNING: Supabase credentials missing. Ingestion and Retrieval will be disabled. Check your environment variables.')
}

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : { from: () => ({ select: () => ({ eq: () => ({ single: () => ({ data: null }) }), single: () => ({ data: null }) }), insert: () => ({}) }), storage: { from: () => ({ upload: () => ({}) }) } }; // Mock to prevent crash
