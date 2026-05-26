import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qdwtdrezwfrpdfsxjhps.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkd3RkcmV6d2ZycGRmc3hqaHBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDAyODYsImV4cCI6MjA5NTM3NjI4Nn0.nFOYWqEmXAS6hv-EsCoHWAe9FL2FQ8lnD18Kcgawroc'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)