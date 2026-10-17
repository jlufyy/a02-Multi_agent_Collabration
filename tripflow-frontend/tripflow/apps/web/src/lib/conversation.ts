import type { ConversationMessage } from '@tripflow/contracts';

type Conversational =
  | { role: 'user' | 'assistant'; text: string }
  | { role: 'clarify'; questions: string[] }
  | { role: 'content'; content: { body: string } }
  | { role: 'nearby' };

/** Clarification options must accompany replies such as "choose A". */
export function buildConversation(messages: readonly Conversational[]): ConversationMessage[] {
  return messages.flatMap((m): ConversationMessage[] => {
    if (m.role === 'user' || m.role === 'assistant') return [{ role: m.role, content: m.text }];
    if (m.role === 'clarify') return [{ role: 'assistant', content: m.questions.join('\n') }];
    if (m.role === 'content') return [{ role: 'assistant', content: m.content.body.slice(0, 1800) }];
    return [];
  }).slice(-10);
}
