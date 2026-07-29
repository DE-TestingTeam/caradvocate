/**
 * Canned Ask CA replies.
 *
 * PLACEHOLDER. There is no model call here -- replies cycle deterministically so
 * the UI has something to render. When the real LLM lands, this is the seam:
 * return the same shape and every urgency callout and CTA the client already
 * renders keeps working.
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

/**
 * Picks a reply from the existing message count so a given conversation always
 * advances rather than repeating.
 */
export function nextReply(assistantMessageCount: number): Reply {
  return replies[assistantMessageCount % replies.length];
}
