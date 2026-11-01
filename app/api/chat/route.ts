/**
 * ============================================================================
 * JUICYCHAT.AI - CHAT STREAMING API (PHASE 1)
 * ============================================================================
 * OpenAI-compatible SSE streaming endpoint supporting normal, swipe, continue,
 * and impersonate modes. Connects to OpenRouter / OpenAI-compatible LLMs.
 * Persists responses to the messages table (except impersonate mode).
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, requireAuth, getUser } from '@/lib/supabase/server';
import { compilePrompt, estimateTokens, getMessageContent, replaceMacros } from '@/lib/prompt-builder';
import type { ChatRequestBody, ChatStreamEvent, ChatMode, GenerationSettings, DEFAULT_GENERATION_SETTINGS } from '@/types/database';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

function isValidChatMode(mode: string | undefined): mode is ChatMode {
  return ['normal', 'swipe', 'continue', 'impersonate'].includes(mode || '');
}

function parseGenerationSettings(raw: unknown): GenerationSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_GENERATION_SETTINGS;
  const s = raw as Partial<GenerationSettings>;
  return {
    model: s.model || DEFAULT_GENERATION_SETTINGS.model,
    temperature: s.temperature ?? DEFAULT_GENERATION_SETTINGS.temperature,
    max_tokens: s.max_tokens ?? DEFAULT_GENERATION_SETTINGS.max_tokens,
    top_p: s.top_p ?? DEFAULT_GENERATION_SETTINGS.top_p,
    presence_penalty: s.presence_penalty ?? DEFAULT_GENERATION_SETTINGS.presence_penalty,
    frequency_penalty: s.frequency_penalty ?? DEFAULT_GENERATION_SETTINGS.frequency_penalty,
    prompt_preset: s.prompt_preset ?? DEFAULT_GENERATION_SETTINGS.prompt_preset,
  };
}

/**
 * Build the messages array for the LLM: system prompt + conversation history.
 */
function buildLLMMessages(context: any): Array<{ role: string; content: string }> {
  return [
    { role: 'system', content: context.fullSystemPrompt },
    ...context.conversationHistory.map((h) => ({ role: h.role, content: h.content })),
    { role: 'system', content: context.steeringNote },
  ];
}

/**
 * Stream tokens from OpenRouter via SSE and forward to the client.
 */
async function* streamOpenRouter(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  settings: GenerationSettings,
  abortController: AbortController
): AsyncGenerator<string> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://juicychat.local',
      'X-Title': 'JuicyChat.AI Clone',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.max_tokens,
      top_p: settings.top_p,
      presence_penalty: settings.presence_penalty,
      frequency_penalty: settings.frequency_penalty,
      stream: true,
    }),
    signal: abortController.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('OpenRouter returned no response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  // --- Auth ---
  const session = await requireAuth();
  const user = await getUser();
  if (!user || !session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = createServerSupabaseClient();

  // --- Parse body ---
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, message, mode = 'normal', characterId, personaId, generationSettings } = body;

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const modeVal: ChatMode = isValidChatMode(mode) ? mode : 'normal';
  const settings: GenerationSettings = parseGenerationSettings(generationSettings);

  // --- Fetch session & character ---
  const { data: sessionData, error: sessionError } = await client
    .from('chat_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (sessionError || !sessionData) {
    return NextResponse.json({ error: 'Chat session not found' }, { status: 404 });
  }

  const { data: character, error: characterError } = await client
    .from('characters')
    .select('*')
    .eq('id', sessionData.character_id)
    .single();

  if (characterError || !character) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  }

  // --- Fetch persona ---
  let persona = null;
  const activePersonaId = personaId || sessionData.persona_id;
  if (activePersonaId) {
    const { data: p } = await client
      .from('user_personas')
      .select('*')
      .eq('id', activePersonaId)
      .eq('user_id', user.id)
      .single();
    persona = p;
  }
  if (!persona) {
    // Fall back to default persona
    const { data: p } = await client
      .from('user_personas')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .single();
    persona = p;
  }
  if (!persona) {
    return NextResponse.json({ error: 'No persona found for user' }, { status: 400 });
  }

  // --- Fetch lorebook ---
  const { data: lorebookEntries } = await client
    .from('lorebook_entries')
    .select('*')
    .eq('character_id', character.id)
    .eq('enabled', true);

  // --- Fetch messages ---
  const { data: allMessages } = await client
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  const messages: any[] = allMessages ?? [];

  // --- Determine content for user turn ---
  let userContent = message || '';

  // For continue/impersonate/swipe on empty first turn, userContent may be empty
  // For normal mode, we need a message
  if (modeVal === 'normal' && !userContent) {
    return NextResponse.json({ error: 'Message content is required for normal mode' }, { status: 400 });
  }

  // --- Build prompt context ---
  const recentMessages = messages.slice(-20);
  const pinnedMessages = messages.filter((m) => m.is_pinned);

  const context = compilePrompt({
    character: character as any,
    persona: persona as any,
    session: sessionData as any,
    lorebookEntries: (lorebookEntries ?? []) as any[],
    pinnedMessages: pinnedMessages as any[],
    recentMessages: recentMessages as any[],
    mode: modeVal,
  });

  // --- Build LLM messages ---
  const llmMessages = buildLLMMessages(context);

  // If normal mode, append the user's new message as a user turn
  if (modeVal === 'normal' && userContent) {
    llmMessages.push({ role: 'user', content: replaceMacros(userContent, character.name, persona.name) });
  }

  // --- SSE Response ---
  const abortController = new AbortController();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: 'start', mode: modeVal, sessionId });

      let fullContent = '';
      let aborted = false;

      try {
        if (!OPENROUTER_API_KEY) {
          send({ type: 'error', error: 'OpenRouter API key not configured. Set OPENROUTER_API_KEY.' });
          controller.close();
          return;
        }

        for await (const token of streamOpenRouter(
          OPENROUTER_API_KEY,
          settings.model,
          llmMessages,
          settings,
          abortController
        )) {
          if (abortController.signal.aborted) {
            aborted = true;
            break;
          }
          fullContent += token;
          send({ type: 'token', content: token });
        }

        if (aborted) {
          send({ type: 'aborted', partialContent: fullContent });
          controller.close();
          return;
        }

        // --- Persistence (skip for impersonate mode) ---
        if (modeVal !== 'impersonate') {
          // Determine sender
          const sender = modeVal === 'impersonate' ? 'user' : 'character';

          // Check if there's an existing character message to append swipe to
          let targetMessage: any = null;
          if (modeVal === 'swipe' || modeVal === 'continue') {
            // Find the most recent character message to append to
            const lastCharMsg = [...messages].reverse().find((m) => m.sender === 'character');
            if (lastCharMsg) {
              targetMessage = lastCharMsg;
            }
          }

          if (targetMessage) {
            // Append as new swipe
            const swipes = [...targetMessage.swipes, fullContent];
            const newIndex = swipes.length - 1;

            await client
              .from('messages')
              .update({ swipes, active_swipe_index: newIndex })
              .eq('id', targetMessage.id);

            send({
              type: 'done',
              messageId: targetMessage.id,
              content: fullContent,
              swipes,
              activeSwipeIndex: newIndex,
            });
          } else {
            // Insert new character message
            const inserted = await client
              .from('messages')
              .insert({
                session_id: sessionId,
                sender: 'character',
                swipes: [fullContent],
                active_swipe_index: 0,
                is_pinned: false,
              })
              .select()
              .single();

            send({
              type: 'done',
              messageId: inserted.id,
              content: fullContent,
              swipes: [fullContent],
              activeSwipeIndex: 0,
            });
          }

          // If normal mode, also insert the user message
          if (modeVal === 'normal' && userContent) {
            await client
              .from('messages')
              .insert({
                session_id: sessionId,
                sender: 'user',
                swipes: [userContent],
                active_swipe_index: 0,
                is_pinned: false,
              });
          }
        } else {
          // impersonate mode: stream into user's input box, no persistence
          send({ type: 'done', messageId: '', content: fullContent, swipes: [], activeSwipeIndex: -1 });
        }

      } catch (err: any) {
        send({ type: 'error', error: err.message || 'Stream failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}