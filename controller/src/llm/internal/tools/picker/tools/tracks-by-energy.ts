import { tool } from 'ai';
import { z } from 'zod';
import * as library from '../../../../../music/library.js';
import { definePickerTool } from '../defs.js';

export default definePickerTool({
  name: 'tracksByEnergy',
  build: ({ collect, emptyResult }) => tool({
    description: 'Songs tagged with an energy level: low (slow/mellow), medium (mid-tempo), high (uptempo/driving). For time-of-day or activity picks — high for a workout, low for a wind-down.',
    inputSchema: z.object({ energy: z.enum(['low', 'medium', 'high']) }),
    execute: async ({ energy }) => {
      try {
        await library.load();
        const list = library.songsByEnergy(energy);
        const out = collect(list);
        return out.length ? out : emptyResult(list.length, `no ${energy}-energy tracks available — choose from your other tool results this round`);
      }
      catch (err) { return { error: (err as Error).message }; }
    },
  }),
});
