import { HazardPoint } from './types';

export const DEFAULT_HAZARD: Record<string, HazardPoint[]> = {
  rp2475: [{T:0,Sa:0.732},{T:0.2,Sa:0.732},{T:0.5,Sa:0.699},{T:1,Sa:0.397},{T:2,Sa:0.242},{T:5,Sa:0.077},{T:10,Sa:0.027}],
  rp975:  [{T:0,Sa:0.557},{T:0.2,Sa:0.557},{T:0.5,Sa:0.491},{T:1,Sa:0.273},{T:2,Sa:0.162},{T:5,Sa:0.046},{T:10,Sa:0.016}],
  rp475:  [{T:0,Sa:0.406},{T:0.2,Sa:0.406},{T:0.5,Sa:0.354},{T:1,Sa:0.192},{T:2,Sa:0.111},{T:5,Sa:0.027},{T:10,Sa:0.010}]
};

export const DEFAULT_PGA_REFS = { rp2475: 0.343, rp975: 0.242, rp475: 0.176 };
