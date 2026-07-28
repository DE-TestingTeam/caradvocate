import type { MaintenanceItem } from '@/types';

export const maintenanceItems: MaintenanceItem[] = [
  { id: 'mnt_1', label: 'Fuel Pump Control Unit', status: 'open_recall' },
  { id: 'mnt_2', label: 'Oil Change - Due in 1,200 mi', status: 'upcoming' },
  { id: 'mnt_3', label: 'Brake Fluid Flush - Due Sep 2025', status: 'upcoming' },
  { id: 'mnt_4', label: 'Tire Rotation - Overdue', status: 'overdue' },
];
