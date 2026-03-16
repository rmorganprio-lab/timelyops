import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vrssqhzzdhlqnptengju.supabase.co'
const supabaseAnonKey = 'sb_publishable_hkvBrKwAUDpbJ1z_c8gb4A_WqxAPNm-'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
