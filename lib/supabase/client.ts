/**
 * ============================================================================
 * JUICYCHAT.AI - BROWSER SUPABASE CLIENT (PHASE 1)
 * ============================================================================
 * Client-side Supabase client using @supabase/ssr createBrowserClient.
 * Includes auth helpers for sign-up, sign-in, sign-out, and session management.
 * ============================================================================
 */

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Create (or return cached) browser Supabase client.
 * Safe to call multiple times; returns a singleton within the same module scope.
 */
export function createClient() {
  if (browserClient) return browserClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables. ' +
      'Please add them to your .env.local file.'
    );
  }

  browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  return browserClient;
}

/** Default exported client instance for convenience. */
export const supabase = createClient();

/* ------------------------------------------------------------------ */
/* Auth Helpers                                                       */
/* ------------------------------------------------------------------ */

/** Get the current authenticated session. */
export async function getSession() {
  const client = createClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

/** Get the current authenticated user. */
export async function getUser() {
  const client = createClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data.user;
}

/**
 * Sign up a new user with email, password, and optional username.
 * The database trigger handle_new_user() will create the profile + default persona.
 */
export async function signUp(credentials: { email: string; password: string; username?: string }) {
  const client = createClient();
  const { data, error } = await client.auth.signUp({
    email: credentials.email,
    password: credentials.password,
    options: {
      data: {
        username: credentials.username || null,
      },
    },
  });
  if (error) throw error;
  return data;
}

/** Sign in with email and password. */
export async function signIn(credentials: { email: string; password: string }) {
  const client = createClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error) throw error;
  return data;
}

/** Sign out the current user. */
export async function signOut() {
  const client = createClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

/** Listen to auth state changes. Returns a Subscription object with .unsubscribe(). */
export async function onAuthStateChange(callback: (event: string, session: any) => void) {
  const client = createClient();
  const { data } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return data;
}

/* ------------------------------------------------------------------ */
/* Profile Helpers                                                    */
/* ------------------------------------------------------------------ */

/** Fetch the current user's profile. */
export async function getProfile(userId: string) {
  const client = createClient();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/** Update the current user's profile. */
export async function updateProfile(userId: string, updates: Partial<Profile>) {
  const client = createClient();
  const { data, error } = await client
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Upload an avatar image to the 'avatars' storage bucket. Returns public URL. */
export async function uploadAvatar(file: File, userId: string) {
  const client = createClient();
  const fileExt = file.name.split('.').pop();
  const fileName = `${userId}/${Date.now()}.${fileExt}`;

  const { data, error } = await client.storage
    .from('avatars')
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw error;

  const { data: urlData } = client.storage.from('avatars').getPublicUrl(data.path);
  return { path: data.path, url: urlData.publicUrl, bucket: 'avatars' };
}

/** Delete an avatar from storage. */
export async function deleteAvatar(path: string) {
  const client = createClient();
  const { error } = await client.storage.from('avatars').remove([path]);
  if (error) throw error;
}