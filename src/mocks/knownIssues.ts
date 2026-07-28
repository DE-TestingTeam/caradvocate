import type { KnownIssue } from '@/types';

export const knownIssues: KnownIssue[] = [
  { id: 'iss_1', label: 'Transmission hesitation under load', severity: 'medium' },
  { id: 'iss_2', label: 'AC compressor failure (2018-2020)', severity: 'high' },
  { id: 'iss_3', label: 'Infotainment screen flickering', severity: 'low' },
];
