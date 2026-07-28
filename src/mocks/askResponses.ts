import type { ChatMessage } from '@/types';

/** Seeded conversation, transcribed verbatim from viewport-mobile-1.png. */
export const seedMessages: ChatMessage[] = [
  {
    id: 'msg_1',
    role: 'user',
    text: 'My car makes a grinding sound when I brake',
  },
  {
    id: 'msg_2',
    role: 'assistant',
    text: 'This is commonly caused by worn brake pads grinding against the rotor. It can also indicate rotor damage or a stuck caliper.',
    urgency: { level: 'high', text: 'Urgency: High - avoid highway driving until inspected' },
  },
  {
    id: 'msg_3',
    role: 'user',
    text: 'How much should I expect to pay to fix this?',
  },
  {
    id: 'msg_4',
    role: 'assistant',
    text: 'To find out how much this repair costs, please start a repair assessment.',
    cta: { label: 'CHECK REPAIR COSTS', action: 'start_assessment' },
  },
];

/**
 * Canned replies cycled through on send. There is no LLM in this build -- swap
 * sendChatMessage() in src/lib/api.ts for a real endpoint later.
 */
export const cannedReplies: Omit<ChatMessage, 'id'>[] = [
  {
    role: 'assistant',
    text: 'Based on your 2019 Honda Civic at 68,400 miles, that symptom is most often wear-related rather than a failure. A shop should be able to confirm it visually in under 30 minutes.',
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
