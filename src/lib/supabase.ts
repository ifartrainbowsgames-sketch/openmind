import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_KEY as string

if (!url || !key) {
  console.warn('Supabase env vars missing — auth and cloud sync disabled.')
}

export const supabase = createClient(url ?? 'https://placeholder.supabase.co', key ?? 'placeholder')
