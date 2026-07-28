import type { Account } from '@/types';

export const account: Account = {
  name: 'Alex Rivera',
  email: 'alex.rivera@email.com',
  phone: '(555) 018-2245',
  memberSince: '2024',
  plan: 'paid',
  features: [
    { name: 'My Car', status: 'Included' },
    { name: 'Ask CA', status: 'Included' },
    { name: 'Repair Cost Checker', status: 'Active' },
  ],
};
