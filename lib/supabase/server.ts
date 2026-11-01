/**
 * ============================================================================
 * JUICYCHAT.AI - SERVER SUPABASE CLIENT (PHASE 1)
 * ============================================================================
 * Server-side Supabase client using @supabase/ssr createServerClient.
 * Includes auth helpers for reading cookies/headers in Route Handlers and
 * Server Components, plus database query helpers used by API routes.
 * ============================================================================
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { cookies } from 'next/headers';

let serverClient: ReturnType<typeof createServerClient<Database>> | null = null;

/**
 * Create a server Supabase client bound to the current request's cookies.
 * Must be called within a Next.js request context (Route Handler or Server Component).
 */
export function createServerSupabaseClient() {
  if (serverClient) return serverClient;

  const cookieStore = cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.'
    );
  }

  serverClient = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // The `set` method was called from a Server Component where cookies cannot be set.
          // This is a no-op for read-only contexts.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // No-op for read-only contexts.
        }
      },
    },
  });

  return serverClient;
}

/** Default exported server client instance. */
export const supabase = createServerSupabaseClient();

/** Service-role client for admin operations (bypasses RLS). Use with care. */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }

  return createServerClient<Database>(supabaseUrl, serviceRoleKey, {
    cookies: {
      get() {
        return undefined;
      },
      set() {},
      remove() {},
    },
  });
}

/* ------------------------------------------------------------------ */
/* Auth Helpers (Server)                                              */
/* ------------------------------------------------------------------ */

/** Get the current server-side session. Returns null if unauthenticated. */
export async function getSession() {
  const client = createServerSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data.session;
}

/** Get the current authenticated user. Returns null if unauthenticated. */
export async function getUser() {
  const client = createServerSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}

/** Require authentication; throws if no session. */
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    const err: any = new Error('Unauthorized: authentication required.');
    err.status = 401;
    throw err;
  }
  return session;
}

/* ------------------------------------------------------------------ */
/* Profile / Persona / Character Query Helpers                        */
/* ------------------------------------------------------------------ */

/** Fetch a profile by ID. */
export async function getProfile(userId: string) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/** Fetch personas for a user. */
export async function getUserPersonas(userId: string) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('user_personas')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Fetch a character by ID (respects visibility RLS). */
export async function getCharacter(characterId: string) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('characters')
    .select('*')
    .eq('id', characterId)
    .single();
  if (error) throw error;
  return data;
}

/** Fetch lorebook entries for a character. */
export async function getLorebookEntries(characterId: string) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('lorebook_entries')
    .select('*')
    .eq('character_id', characterId)
    .eq('enabled', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Fetch messages for a session, newest first. */
export async function getMessages(sessionId: string, limit = 100) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Fetch pinned messages for a session. */
export async function getPinnedMessages(sessionId: string) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_pinned', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Upsert a message (insert or update). Used for swipe persistence. */
export async function upsertMessage(message: {
  session_id: string;
  sender: 'user' | 'character' | 'system';
  swipes: string[];
  active_swipe_index: number;
  is_pinned?: boolean;
  id?: string;
}) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('messages')
    .upsert(message, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Insert a new message. */
export async function insertMessage(message: {
  session_id: string;
  sender: 'user' | 'character' | 'system';
  swipes: string[];
  active_swipe_index?: number;
  is_pinned?: boolean;
}) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('messages')
    .insert(message)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Delete a message and all subsequent messages (created_at >= target). */
export async function deleteMessageAndAfter(sessionId: string, createdAt: string) {
  const client = createServerSupabaseClient();
  const { error } = await client
    .from('messages')
    .delete()
    .eq('session_id', sessionId)
    .gte('created_at', createdAt);
  if (error) throw error;
}

/** Toggle is_pinned on a message. */
export async function togglePinMessage(messageId: string, isPinned: boolean) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('messages')
    .update({ is_pinned: isPinned })
    .eq('id', messageId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Update chat session metadata (title, memory_summary, generation_settings). */
export async function updateChatSession(sessionId: string, updates: {
  title?: string;
  memory_summary?: string;
  generation_settings?: Record<string, unknown>;
}) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('chat_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Toggle like on a character. Returns whether it was liked after the operation. */
export async function toggleCharacterLike(userId: string, characterId: string) {
  const client = createServerSupabaseClient();

  // Check existing like
  const { data: existing } = await client
    .from('character_likes')
    .select('user_id')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .maybeSingle();

  if (existing) {
    const { error } = await client
      .from('character_likes')
      .delete()
      .eq('user_id', userId)
      .eq('character_id', characterId);
    if (error) throw error;
    return { liked: false };
  } else {
    const { error } = await client
      .from('character_likes')
      .insert({ user_id: userId, character_id: characterId });
    if (error) throw error;
    return { liked: true };
  }
}

/** Check if current user has liked a character. */
export async function hasUserLikedCharacter(userId: string, characterId: string) {
  const client = createServerSupabaseClient();
  const { data, error } = await client
    .from('character_likes')
    .select('user_id')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/* ------------------------------------------------------------------ */
/* Storage Helpers (Server)                                           */
/* ------------------------------------------------------------------ */

/** Get a public URL for an avatar file. */
export function getAvatarPublicUrl(path: string) {
  const client = createServerSupabaseClient();
  const { data } = client.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}