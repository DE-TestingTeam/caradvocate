import type { ServiceRecord } from '@/types';

export const serviceHistory: ServiceRecord[] = [
  {
    id: 'svc_1',
    description: 'Battery replacement',
    date: '2026-06-14',
    cost: 175,
    source: 'repair_cost_checker',
  },
  { id: 'svc_2', description: 'Brake pads & rotors - front', date: '2026-03-08', cost: 310, source: 'manual' },
  { id: 'svc_3', description: 'Oil Change & Filter', date: '2025-03-22', cost: 62, source: 'manual' },
  { id: 'svc_4', description: 'Brake Pads (Front)', date: '2024-11-02', cost: 285, source: 'manual' },
  { id: 'svc_5', description: 'Tire Rotation', date: '2024-06-19', cost: 40, source: 'manual' },
];
