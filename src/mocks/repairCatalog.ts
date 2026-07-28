import type { RepairCatalogItem } from '@/types';

/**
 * The first four entries are the rows legible in new-assessment-mobile.png.
 * The rest are additions so the picker list genuinely scrolls.
 */
export const repairCatalog: RepairCatalogItem[] = [
  { id: 'rep_brake_pad', name: 'Brake Pad Replacement' },
  { id: 'rep_oil', name: 'Oil Change & Filter' },
  { id: 'rep_trans_flush', name: 'Transmission Flush' },
  { id: 'rep_ac_recharge', name: 'AC Recharge' },
  { id: 'rep_ac_compressor', name: 'AC Compressor Replacement' },
  { id: 'rep_timing_belt', name: 'Timing Belt Inspection' },
  { id: 'rep_battery', name: 'Battery Replacement' },
  { id: 'rep_alternator', name: 'Alternator Replacement' },
  { id: 'rep_tire_rotation', name: 'Tire Rotation' },
  { id: 'rep_coolant', name: 'Coolant Flush' },
  { id: 'rep_spark_plugs', name: 'Spark Plug Replacement' },
  { id: 'rep_wheel_align', name: 'Wheel Alignment' },
];
