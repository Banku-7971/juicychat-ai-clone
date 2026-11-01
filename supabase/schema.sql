-- ============================================================================
-- JUICYCHAT.AI - COMPLETE SUPABASE DATABASE SCHEMA (PHASE 1)
-- ============================================================================
-- This migration creates every table, index, RLS policy, storage bucket,
-- and automated trigger required for the 1:1 functional JuicyChat clone.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enable required extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. profiles
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id           UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username     TEXT    UNIQUE NOT NULL,
  avatar_url   TEXT,
  bio          TEXT,
  nsfw_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. user_personas
-- ----------------------------------------------------------------------------
CREATE TABLE public.user_personas (
  id            UUID    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  avatar_url    TEXT,
  description   TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. characters
-- ----------------------------------------------------------------------------
CREATE TABLE public.characters (
  id                 UUID      NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id         UUID      REFERENCES public.profiles(id) ON DELETE SET NULL,
  name               TEXT      NOT NULL,
  avatar_url         TEXT      NOT NULL,
  tagline            TEXT      NOT NULL DEFAULT '',
  description        TEXT      NOT NULL DEFAULT '',
  personality        TEXT      NOT NULL DEFAULT '',
  scenario           TEXT      NOT NULL DEFAULT '',
  first_message      TEXT      NOT NULL DEFAULT '',
  alternate_greetings TEXT[]   NOT NULL DEFAULT '{}',
  example_dialogue   TEXT      NOT NULL DEFAULT '',
  system_prompt_override TEXT,
  tags               TEXT[]    NOT NULL DEFAULT '{}',
  visibility         TEXT      NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private','unlisted')),
  rating             TEXT      NOT NULL DEFAULT 'NSFW' CHECK (rating IN ('SFW','NSFW')),
  chat_count         INTEGER   NOT NULL DEFAULT 0,
  message_count      INTEGER   NOT NULL DEFAULT 0,
  like_count         INTEGER   NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. character_likes
-- ----------------------------------------------------------------------------
CREATE TABLE public.character_likes (
  user_id      UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  character_id UUID    NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);

-- ----------------------------------------------------------------------------
-- 5. lorebook_entries
-- ----------------------------------------------------------------------------
CREATE TABLE public.lorebook_entries (
  id          UUID      NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  character_id UUID     NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  keywords    TEXT[]    NOT NULL DEFAULT '{}',
  content     TEXT      NOT NULL DEFAULT '',
  enabled     BOOLEAN   NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 6. chat_sessions
-- ----------------------------------------------------------------------------
CREATE TABLE public.chat_sessions (
  id                 UUID      NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID      NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  character_id       UUID      NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  persona_id         UUID      REFERENCES public.user_personas(id) ON DELETE SET NULL,
  title              TEXT      NOT NULL DEFAULT 'New Chat',
  memory_summary     TEXT      NOT NULL DEFAULT '',
  generation_settings JSONB    NOT NULL DEFAULT '{"model":"deepseek/deepseek-chat","temperature":0.85,"max_tokens":600,"top_p":0.9,"presence_penalty":0.4,"frequency_penalty":0.4,"prompt_preset":"juicy_unfiltered"}'::jsonb,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 7. messages
-- ----------------------------------------------------------------------------
CREATE TABLE public.messages (
  id                UUID      NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id        UUID      NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  sender            TEXT      NOT NULL CHECK (sender IN ('user','character','system')),
  swipes            TEXT[]    NOT NULL DEFAULT '{}',
  active_swipe_index INTEGER  NOT NULL DEFAULT 0,
  is_pinned         BOOLEAN   NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Indexes for performance
-- ----------------------------------------------------------------------------
CREATE INDEX idx_profiles_username ON public.profiles(username);
CREATE INDEX idx_profiles_created_at ON public.profiles(created_at DESC);

CREATE INDEX idx_user_personas_user_id ON public.user_personas(user_id);
CREATE INDEX idx_user_personas_is_default ON public.user_personas(user_id, is_default);

CREATE INDEX idx_characters_creator_id ON public.characters(creator_id);
CREATE INDEX idx_characters_visibility ON public.characters(visibility);
CREATE INDEX idx_characters_rating ON public.characters(rating);
CREATE INDEX idx_characters_tags ON public.characters USING GIN(tags);
CREATE INDEX idx_characters_chat_count ON public.characters(chat_count DESC);
CREATE INDEX idx_characters_like_count ON public.characters(like_count DESC);
CREATE INDEX idx_characters_created_at ON public.characters(created_at DESC);

CREATE INDEX idx_character_likes_user_id ON public.character_likes(user_id);
CREATE INDEX idx_character_likes_character_id ON public.character_likes(character_id);

CREATE INDEX idx_lorebook_entries_character_id ON public.lorebook_entries(character_id);

CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_character_id ON public.chat_sessions(character_id);
CREATE INDEX idx_chat_sessions_persona_id ON public.chat_sessions(persona_id);
CREATE INDEX idx_chat_sessions_updated_at ON public.chat_sessions(updated_at DESC);

CREATE INDEX idx_messages_session_id ON public.messages(session_id);
CREATE INDEX idx_messages_session_created ON public.messages(session_id, created_at);
CREATE INDEX idx_messages_is_pinned ON public.messages(session_id, is_pinned);

-- ----------------------------------------------------------------------------
-- RLS: Enable Row Level Security on all tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lorebook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- profiles RLS policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can delete their own profile" ON public.profiles
  FOR DELETE USING (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- user_personas RLS policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Personas are viewable by everyone" ON public.user_personas
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own personas" ON public.user_personas
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own personas" ON public.user_personas
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own personas" ON public.user_personas
  FOR DELETE USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- characters RLS policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Public and unlisted characters are viewable by everyone" ON public.characters
  FOR SELECT USING (visibility IN ('public','unlisted'));

CREATE POLICY "Private characters are viewable by their creator" ON public.characters
  FOR SELECT USING (visibility = 'private' AND auth.uid() = creator_id);

CREATE POLICY "Authenticated users can insert characters" ON public.characters
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update their own characters" ON public.characters
  FOR UPDATE USING (auth.uid() = creator_id);

CREATE POLICY "Creators can delete their own characters" ON public.characters
  FOR DELETE USING (auth.uid() = creator_id);

-- ----------------------------------------------------------------------------
-- character_likes RLS policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Likes are viewable by everyone" ON public.character_likes
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert likes" ON public.character_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own likes" ON public.character_likes
  FOR DELETE USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- lorebook_entries RLS policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Lorebook entries are viewable by everyone" ON public.lorebook_entries
  FOR SELECT USING (true);

CREATE POLICY "Character creators can manage lorebook entries" ON public.lorebook_entries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.characters c
      WHERE c.id = lorebook_entries.character_id
        AND (c.visibility IN ('public','unlisted') OR auth.uid() = c.creator_id)
    )
  );

-- ----------------------------------------------------------------------------
-- chat_sessions RLS policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view their own chat sessions" ON public.chat_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chat sessions" ON public.chat_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chat sessions" ON public.chat_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chat sessions" ON public.chat_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- messages RLS policies
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view messages in their own sessions" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      WHERE cs.id = messages.session_id AND cs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages in their own sessions" ON public.messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      WHERE cs.id = messages.session_id AND cs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update messages in their own sessions" ON public.messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      WHERE cs.id = messages.session_id AND cs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete messages in their own sessions" ON public.messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      WHERE cs.id = messages.session_id AND cs.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 8. Automated Triggers & RPCs
-- ----------------------------------------------------------------------------

-- handle_new_user(): On auth.users insert, create profile + default persona
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert profile
  INSERT INTO public.profiles (id, username, avatar_url, bio, nsfw_enabled, created_at)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'username',''), split_part(NEW.email,'@',1) || floor(random()*10000)::text),
    NULL,
    NULL,
    true,
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert default persona
  INSERT INTO public.user_personas (user_id, name, avatar_url, description, is_default, created_at)
  VALUES (
    NEW.id,
    'Traveler',
    NULL,
    'A curious traveler ready for adventure.',
    true,
    now()
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- handle_character_like_count(): Update like_count on characters
CREATE OR REPLACE FUNCTION public.handle_character_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.characters
    SET like_count = like_count + 1
    WHERE id = NEW.character_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.characters
    SET like_count = GREATEST(like_count - 1, 0)
    WHERE id = OLD.character_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_character_like_count
AFTER INSERT OR DELETE ON public.character_likes
FOR EACH ROW EXECUTE FUNCTION public.handle_character_like_count();

-- handle_chat_session_count(): Increment chat_count on characters
CREATE OR REPLACE FUNCTION public.handle_chat_session_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.characters
    SET chat_count = chat_count + 1
    WHERE id = NEW.character_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_chat_session_count
AFTER INSERT ON public.chat_sessions
FOR EACH ROW EXECUTE FUNCTION public.handle_chat_session_count();

-- handle_message_count(): Increment message_count and update session updated_at
CREATE OR REPLACE FUNCTION public.handle_message_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.characters c
    SET message_count = message_count + 1
    FROM public.chat_sessions cs
    WHERE cs.id = NEW.session_id
      AND c.id = cs.character_id;

    UPDATE public.chat_sessions
    SET updated_at = now()
    WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_message_count
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.handle_message_count();

-- ----------------------------------------------------------------------------
-- Supabase Storage: avatars bucket
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for avatars bucket
CREATE POLICY "Avatar images are publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated users can upload avatars" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "Authenticated users can update their own avatars" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Authenticated users can delete their own avatars" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );