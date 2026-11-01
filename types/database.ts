/**
 * ============================================================================
 * JUICYCHAT.AI - TYPESCRIPT TYPE DEFINITIONS (PHASE 1)
 * ============================================================================
 * All TypeScript interfaces for database tables, generation settings,
 * API payloads, and prompt compiler inputs/outputs.
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* Core Database Table Types                                          */
/* ------------------------------------------------------------------ */

export type Profile = {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  nsfw_enabled: boolean;
  created_at: string;
};

export type UserPersona = {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  description: string | null;
  is_default: boolean;
  created_at: string;
};

export type CharacterRating = 'SFW' | 'NSFW';
export type CharacterVisibility = 'public' | 'private' | 'unlisted';

export type Character = {
  id: string;
  creator_id: string | null;
  name: string;
  avatar_url: string;
  tagline: string;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  alternate_greetings: string[];
  example_dialogue: string;
  system_prompt_override: string | null;
  tags: string[];
  visibility: CharacterVisibility;
  rating: CharacterRating;
  chat_count: number;
  message_count: number;
  like_count: number;
  created_at: string;
};

export type CharacterLike = {
  user_id: string;
  character_id: string;
  created_at: string;
};

export type LorebookEntry = {
  id: string;
  character_id: string;
  keywords: string[];
  content: string;
  enabled: boolean;
  created_at: string;
};

export type ChatSession = {
  id: string;
  user_id: string;
  character_id: string;
  persona_id: string | null;
  title: string;
  memory_summary: string;
  generation_settings: GenerationSettings;
  updated_at: string;
  created_at: string;
};

export type Message = {
  id: string;
  session_id: string;
  sender: 'user' | 'character' | 'system';
  swipes: string[];
  active_swipe_index: number;
  is_pinned: boolean;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* Generation Settings                                                */
/* ------------------------------------------------------------------ */

export type PromptPreset = 'juicy_unfiltered' | 'novel_longform' | 'casual_texting';

export type GenerationSettings = {
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  presence_penalty: number;
  frequency_penalty: number;
  prompt_preset: PromptPreset;
};

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  model: 'deepseek/deepseek-chat',
  temperature: 0.85,
  max_tokens: 600,
  top_p: 0.9,
  presence_penalty: 0.4,
  frequency_penalty: 0.4,
  prompt_preset: 'juicy_unfiltered',
};

export const PRESET_DEFINITIONS: Record<PromptPreset, { label: string; description: string }> = {
  juicy_unfiltered: {
    label: 'Juicy Roleplay - Default',
    description: 'Immersive, descriptive, stays strictly in character, mixes dialogue and *actions*.',
  },
  novel_longform: {
    label: 'Novel / Long-Form',
    description: 'Multi-paragraph literary prose with rich sensory detail.',
  },
  casual_texting: {
    label: 'Fast / Casual Texting',
    description: 'Short, punchy chat responses for quick back-and-forth.',
  },
};

/* ------------------------------------------------------------------ */
/* Chat Modes                                                         */
/* ------------------------------------------------------------------ */

export type ChatMode = 'normal' | 'swipe' | 'continue' | 'impersonate';

export const CHAT_MODE_LABELS: Record<ChatMode, string> = {
  normal: 'Send Message',
  swipe: 'Generate Swipe / Variation',
  continue: 'Continue / Let Bot Speak',
  impersonate: 'Impersonate / Auto-Write User Reply',
};

/* ------------------------------------------------------------------ */
/* API Payload Types                                                  */
/* ------------------------------------------------------------------ */

export type ChatRequestBody = {
  sessionId: string;
  message?: string;              // user message content (normal mode)
  mode?: ChatMode;               // normal | swipe | continue | impersonate
  characterId?: string;          // for swipe/continue on first turn
  personaId?: string;            // active persona override
  generationSettings?: Partial<GenerationSettings>;
  stream?: boolean;              // always true for SSE
};

export type ChatStreamEvent =
  | { type: 'start'; mode: ChatMode; sessionId: string }
  | { type: 'token'; content: string }
  | { type: 'swipe_index'; index: number; total: number }
  | { type: 'message_id'; id: string }
  | { type: 'done'; messageId: string; content: string; swipes: string[]; activeSwipeIndex: number }
  | { type: 'error'; error: string }
  | { type: 'aborted'; partialContent: string };

export type SummarizeRequestBody = {
  sessionId: string;
  messages: Array<{ sender: string; content: string; created_at: string }>;
  currentSummary?: string;
};

export type SummarizeResponseBody = {
  summary: string;
};

/* ------------------------------------------------------------------ */
/* Prompt Compiler Inputs                                             */
/* ------------------------------------------------------------------ */

export type PromptContext = {
  character: Character;
  persona: UserPersona;
  session: ChatSession;
  lorebookEntries: LorebookEntry[];
  pinnedMessages: Message[];
  recentMessages: Message[];
  mode: ChatMode;
};

export type CompiledPrompt = {
  systemInstruction: string;
  characterDefinition: string;
  userPersona: string;
  lorebookContext: string;
  chatMemory: string;
  exampleDialogue: string;
  steeringNote: string;
  fullSystemPrompt: string;
  conversationHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  estimatedTokens: number;
};

/* ------------------------------------------------------------------ */
/* Storage / Upload Types                                             */
/* ------------------------------------------------------------------ */

export type AvatarUploadResult = {
  path: string;
  url: string;
  bucket: string;
};

/* ------------------------------------------------------------------ */
/* Theme / Palette Constants                                          */
/* ------------------------------------------------------------------ */

export const JUICY_COLORS = {
  backgroundPrimary: '#0B0B0E',
  cardBackground: '#14141A',
  surfaceHover: '#1C1C24',
  border: '#262632',
  primaryGradient: 'bg-gradient-to-r from-[#FF2A85] to-[#8A2BE2]',
  accentPink: '#FF2A85',
  accentPurple: '#8A2BE2',
  actionGlow: '#E879F9',
  textWhite: '#FFFFFF',
  textMuted: '#A1A1AA',
} as const;

export const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
export const PERMANENT_TOKEN_WARN_THRESHOLD = 2000;
export const SLIDING_WINDOW_TOKEN_BUDGET = 6000;
export const MAX_TAGLINE_CHARS = 120;