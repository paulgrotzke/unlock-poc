import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseEnv = {
  [key: string]: unknown;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export function getSupabaseConfig(env: SupabaseEnv = import.meta.env): SupabaseConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  try {
    new URL(supabaseUrl);
  } catch {
    return null;
  }

  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

export function isSupabaseConfigured(env: SupabaseEnv = import.meta.env): boolean {
  return getSupabaseConfig(env) !== null;
}

let cachedClient: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const config = getSupabaseConfig();
  if (!config) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(config.url, config.anonKey);
  return cachedClient;
}
