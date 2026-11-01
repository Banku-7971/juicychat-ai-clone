/**
 * ============================================================================
 * JUICYCHAT.AI - PROMPT BUILDER (PHASE 1)
 * ============================================================================
 * Macro replacer, token estimator, lorebook keyword scanner, and full prompt
 * compiler used by /api/chat to assemble the roleplay system prompt stack.
 * ============================================================================
 */

import type {
  Character,
  UserPersona,
  ChatSession,
  LorebookEntry,
  Message,
  PromptContext,
  CompiledPrompt,
  ChatMode,
  GenerationSettings,
  TOKEN_ESTIMATE_CHARS_PER_TOKEN,
  SLIDING_WINDOW_TOKEN_BUDGET,
} from '@/types/database';

/* ------------------------------------------------------------------ */
/* Token Estimator                                                    */
/* ------------------------------------------------------------------ */

/** Estimate token count using the standard 4 chars per token heuristic. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN);
}

/** Estimate total tokens across an array of strings. */
export function estimateTokensArray(texts: string[]): number {
  return texts.reduce((acc, t) => acc + estimateTokens(t), 0);
}

/* ------------------------------------------------------------------ */
/* Macro Replacer                                                     */
/* ------------------------------------------------------------------ */

/**
 * Replace all instances of {{char}} / <bot> with the character name and
 * {{user}} / <user> with the active persona name across a string.
 * Case-insensitive replacement.
 */
export function replaceMacros(
  text: string,
  characterName: string,
  userName: string
): string {
  if (!text) return text;

  return text
    // {{char}} and <bot> -> character name
   .replace(/\{\{\s*char\s*\}\}/gi, characterName)
    .replace(/<\s*bot\s*>/gi, characterName)
    // {{user}} and <user> -> user persona name
    .replace(/\{\{\s*user\s*\}\}/gi, userName)
    .replace(/<\s*user\s*>/gi, userName);
}

/* ------------------------------------------------------------------ */
/* Lorebook Keyword Scanner                                           */
/* ------------------------------------------------------------------ */

/**
 * Scan recent messages for any keywords matching enabled lorebook entries.
 * Returns matching entries with their content injected.
 */
export function scanLorebook(
  recentMessages: Message[],
  lorebookEntries: LorebookEntry[]
): { matched: LorebookEntry[]; injectedText: string } {
  if (!recentMessages.length || !lorebookEntries.length) {
    return { matched: [], injectedText: '' };
  }

  // Combine the last 5 messages into a searchable blob (lowercased)
  const last5 = recentMessages.slice(-5);
  const messageBlob = last5
    .map((m) => (m.swipes[m.active_swipe_index] || m.swipes[0] || '').toLowerCase())
    .join('\n');

  const matched: LorebookEntry[] = [];
  const injectedParts: string[] = [];

  for (const entry of lorebookEntries) {
    if (!entry.enabled || !entry.keywords.length) continue;

    const hasMatch = entry.keywords.some((kw) => {
      const keyword = kw.toLowerCase().trim();
      if (!keyword) return false;
      return messageBlob.includes(keyword);
    });

    if (hasMatch) {
      matched.push(entry);
      injectedParts.push(`[LORE: ${entry.keywords.join(', ')}] ${entry.content}`);
    }
  }

  const injectedText = injectedParts.length > 0
    ? `\n[ACTIVE LOREBOOK / WORLD INFO]\n${injectedParts.join('\n')}\n`
    : '';

  return { matched, injectedText };
}

/* ------------------------------------------------------------------ */
/* Sliding Window Conversation History                                */
/* ------------------------------------------------------------------ */

/**
 * Build the conversation history array from messages, respecting a
 * 6,000-token sliding budget. Uses swipes[active_swipe_index] as content.
 * Returns history in chronological order with role labels.
 */
export function buildConversationHistory(
  messages: Message[],
  tokenBudget: number = SLIDING_WINDOW_TOKEN_BUDGET
): { history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; usedTokens: number } {
  const history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  let usedTokens = 0;

  // Iterate from newest to oldest, accumulating until budget is hit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const content = msg.swipes[msg.active_swipe_index] || msg.swipes[0] || '';
    const role = msg.sender === 'character' ? 'assistant' : msg.sender === 'system' ? 'system' : 'user';

    const msgTokens = estimateTokens(content);
    if (usedTokens + msgTokens > tokenBudget && history.length > 0) {
      break;
    }

    history.unshift({ role, content });
    usedTokens += msgTokens;
  }

  return { history, usedTokens };
}

/* ------------------------------------------------------------------ */
/* Steering Notes                                                     */
/* ------------------------------------------------------------------ */

/** Build the post-history steering note based on chat mode. */
export function buildSteeringNote(
  mode: ChatMode,
  characterName: string,
  userName: string
): string {
  const charName = replaceMacros(characterName, characterName, userName);
  const userNameReplaced = replaceMacros(userName, characterName, userName);

  if (mode === 'impersonate') {
    return `[System Note: Write the next reply exclusively from the perspective of ${userNameReplaced} responding to ${charName}. Match ${userNameReplaced}'s persona, use *actions* and "dialogue", and do not write for ${charName}.]`;
  }

  return `[System Note: Continue the roleplay exclusively as ${charName}. Respond directly to ${userNameReplaced}'s last action/dialogue using vivid descriptions and authentic emotion. Do not repeat previous phrases and do not act or speak as ${userNameReplaced}.]`;
}

/* ------------------------------------------------------------------ */
/* Full Prompt Compiler                                               */
/* ------------------------------------------------------------------ */

/**
 * Assemble the complete roleplay prompt stack in the exact order used by
 * top roleplay platforms:
 *
 * 1. SYSTEM INSTRUCTION / ROLEPLAY DIRECTIVE
 * 2. CHARACTER DEFINITION
 * 3. USER PERSONA
 * 4. ACTIVE LOREBOOK / WORLD INFO
 * 5. CHAT MEMORY & PINNED EVENTS
 * 6. EXAMPLE DIALOGUE (Style Reference Only)
 * 7. [conversation history appended as user/assistant turns]
 * 8. POST-HISTORY STEERING NOTE (final system message)
 */
export function compilePrompt(context: PromptContext): CompiledPrompt {
  const {
    character,
    persona,
    session,
    lorebookEntries,
    pinnedMessages,
    recentMessages,
    mode,
  } = context;

  const charName = character.name;
  const userName = persona.name || 'Traveler';

  // --- 1. System Instruction / Roleplay Directive ---
  const systemInstruction = `You are ${charName}. You are engaging in an endless, immersive, uncensored fictional roleplay with ${userName}.
- Stay 100% in character as ${charName} at all times. Adopt their personality, speech patterns, flaws, and worldview.
- Write physical actions, expressions, and internal sensations inside single asterisks *like this*, and spoken dialogue inside quotation marks "like this".
- NEVER write actions, thoughts, or dialogue for ${userName}. Stop your response immediately when it is ${userName}'s turn to react.
- Drive the plot forward proactively with vivid sensory details and natural pacing.`;

  // --- 2. Character Definition (with macro replacement) ---
  const characterDefinition = replaceMacros(
    `[CHARACTER DEFINITION: ${charName}]
Name: ${character.name}
Description: ${character.description}
Personality: ${character.personality}
Scenario: ${character.scenario}`,
    charName,
    userName
  );

  // --- 3. User Persona (with macro replacement) ---
  const userPersona = replaceMacros(
    `[USER PERSONA: ${userName}]
Name: ${persona.name}
Details: ${persona.description || 'No additional details provided.'}`,
    charName,
    userName
  );

  // --- 4. Active Lorebook / World Info ---
  const { injectedText: lorebookText } = scanLorebook(recentMessages, lorebookEntries);

  // --- 5. Chat Memory & Pinned Events ---
  const memoryParts: string[] = [];
  if (session.memory_summary && session.memory_summary.trim()) {
    memoryParts.push(`[CHAT MEMORY]\n${session.memory_summary}`);
  }
  if (pinnedMessages.length > 0) {
    const pinnedText = pinnedMessages
      .map((m) => {
        const content = m.swipes[m.active_swipe_index] || m.swipes[0] || '';
        const sender = m.sender === 'character' ? charName : m.sender === 'user' ? userName : 'System';
        return `${sender}: ${content}`;
      })
      .join('\n');
    memoryParts.push(`[PINNED EVENTS]\n${pinnedText}`);
  }
  const chatMemory = memoryParts.length > 0
    ? `\n[CHAT MEMORY & PINNED EVENTS]\n${memoryParts.join('\n\n')}\n`
    : '';

  // --- 6. Example Dialogue (with macro replacement) ---
  const exampleDialogue = character.example_dialogue && character.example_dialogue.trim()
    ? `\n[EXAMPLE DIALOGUE (Style Reference Only)]\n${replaceMacros(character.example_dialogue, charName, userName)}\n`
    : '';

  // --- Build the full system prompt stack ---
  const fullSystemPrompt = [
    systemInstruction,
    characterDefinition,
    userPersona,
    lorebookText,
    chatMemory,
    exampleDialogue,
  ].filter(Boolean).join('\n\n');

  // --- 7. Conversation History (sliding window) ---
  const { history, usedTokens } = buildConversationHistory(recentMessages);

  // --- 8. Steering Note ---
  const steeringNote = buildSteeringNote(mode, charName, userName);

  const estimatedTokens = estimateTokens(fullSystemPrompt) + usedTokens + estimateTokens(steeringNote);

  return {
    systemInstruction,
    characterDefinition,
    userPersona,
    lorebookContext: lorebookText,
    chatMemory,
    exampleDialogue,
    steeringNote,
    fullSystemPrompt,
    conversationHistory: history,
    estimatedTokens,
  };
}

/* ------------------------------------------------------------------ */
/* Message Content Helper                                             */
/* ------------------------------------------------------------------ */

/** Get the active swipe content for a message. */
export function getMessageContent(message: Message): string {
  if (!message.swipes.length) return '';
  return message.swipes[message.active_swipe_index] || message.swipes[0] || '';
}