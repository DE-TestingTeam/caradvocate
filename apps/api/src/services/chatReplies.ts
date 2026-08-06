/**
 * Canned Ask CA replies, used when no ANTHROPIC_API_KEY is set. Cycles deterministically so the
 * UI has something to render; the shape matches askClaude.ts, so the callouts and CTA the
 * client renders keep working either way.
 */
import type { ChatMessage } from '@caradvocate/shared';

type Reply = Omit<ChatMessage, 'id'>;

const replies: Reply[] = [
  {
    role: 'assistant',
    text: 'Based on your vehicle and mileage, that symptom is most often wear-related rather than a failure. A shop should be able to confirm it visually in under 30 minutes.',
  },
  {
    role: 'assistant',
    text: 'That can point to a few different causes. Worth getting inspected before it progresses.',
    urgency: { level: 'medium', text: 'Urgency: Medium - have this looked at within the next two weeks' },
  },
  {
    role: 'assistant',
    text: 'I can give you a benchmark price range for that repair so you know what a fair quote looks like before you visit a shop.',
    cta: { label: 'CHECK REPAIR COSTS', action: 'start_assessment' },
  },
  {
    role: 'assistant',
    text: 'Nothing in your service history suggests that has been addressed recently, so it is likely still outstanding.',
    urgency: { level: 'low', text: 'Urgency: Low - monitor and mention at your next service' },
  },
];

/** Keyed on the message count so a conversation advances rather than repeating. */
export function nextReply(assistantMessageCount: number): Reply {
  return replies[assistantMessageCount % replies.length];
}
