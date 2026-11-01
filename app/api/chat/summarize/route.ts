/**
 * ============================================================================
 * JUICYCHAT.AI - CHAT MEMORY SUMMARIZER (PHASE 1)
 * ============================================================================
 * Auto-summarizer endpoint that condenses recent chat messages into
 * bullet-point permanent memories stored in chat_sessions.memory_summary.
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, requireAuth, getUser } from '@/lib/supabase/server';
import { estimateTokens } from '@/lib/prompt-builder';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

export async function POST(request: Request) {
  // --- Auth ---
  const session = await requireAuth();
  const user = await getUser();
  if (!user || !session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = createServerSupabaseClient();

  // --- Parse body ---
  let body: { sessionId: string; messages: Array<{ sender: string; content: string; created_at: string }>; currentSummary?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, messages, currentSummary } = body;

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  // --- Verify session ownership ---
  const { data: sessionData, error: sessionError } = await client
    .from('chat_sessions')
    .select('id, user_id, character_id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (sessionError || !sessionData) {
    return NextResponse.json({ error: 'Chat session not found' }, { status: 404 });
  }

  // --- Fetch character name for context ---
  const { data: character } = await client
    .from('characters')
    .select('name')
    .eq('id', sessionData.character_id)
    .single();

  const charName = character?.name || 'the character';

  // --- Build summarization prompt ---
  const messageText = messages
    .map((m) => `${m.sender}: ${m.content}`)
    .join('\n');

  const existingMemory = currentSummary ? `\nExisting memory:\n${currentSummary}` : '';

  const systemPrompt = `You are a memory summarizer for a roleplay chat between a user and ${charName}.
Summarize the conversation below into concise bullet-point permanent memories.
Focus on: key plot events, character decisions, relationship developments, important facts about {{user}} and {{char}}, and ongoing story threads.
Keep it under 500 words. Format as bullet points. Do not include dialogue verbatim unless it reveals a critical fact.
${existingMemory}

Conversation:
${messageText}`;

  // --- Call OpenRouter for summarization ---
  if (!OPENROUTER_API_KEY) {
    // Fallback: simple heuristic summary if no API key
    const fallbackSummary = `• Chat session with ${charName} involving ${messages.length} messages.${currentSummary ? ' Previous memory preserved.' : ''}`;
    return NextResponse.json({ summary: fallbackSummary });
  }

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Summarize the above conversation into permanent memory bullets.' },
        ],
        temperature: 0.5,
        max_tokens: 500,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Summarizer API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content || '';

    // --- Persist to session ---
    const { data: updated, error: updateError } = await client
      .from('chat_sessions')
      .update({ memory_summary: summary })
      .eq('id', sessionId)
      .select('memory_summary')
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({ summary: updated.memory_summary });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Summarization failed' }, { status: 500 });
  }
}