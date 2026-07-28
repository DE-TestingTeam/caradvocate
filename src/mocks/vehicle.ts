import type { Vehicle } from '@/types';

/**
 * Single source of truth for the vehicle.
 *
 * NOTE: the wireframes disagree with each other -- My Car shows a 2019 Honda Civic
 * while Account shows a 2019 Honda CR-V EX. Both screens read this one fixture so
 * they can never drift. Change it here to change it everywhere.
 */
export const vehicle: Vehicle = {
  id: 'veh_1',
  year: 2019,
  make: 'Honda',
  model: 'Civic',
  vin: '2HGFC2F53KH124821',
  mileage: 68400,
  estMarketValue: 14200,
  tradeInLow: 12100,
  tradeInHigh: 14600,
  valueTrend: [
    { month: 'Feb', value: 13250 },
    { month: 'Mar', value: 13400 },
    { month: 'Apr', value: 13620 },
    { month: 'May', value: 13810 },
    { month: 'Jun', value: 14020 },
    { month: 'Jul', value: 14200 },
  ],
};
