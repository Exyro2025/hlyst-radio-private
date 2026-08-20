// Admin-gated GET /stats — usage-stats rollups for the admin Stats page.
//
// Aggregates four in-memory call rings — LLM (llm/log.js), TTS (stats.js),
// the DJ-log (broadcast/queue.js) and listener requests (broadcast/request-log.js)
// — into the breakdowns the Stats page renders. Everything is since-boot and
// lossy on restart by design; the raw per-call lists stay on /debug, this
// surface only carries the rollups.
import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { recentCalls } from '../llm/log.js';
import * as llmProvider from '../llm/provider.js';
import * as settings from '../settings.js';
import { ttsCalls, toolCalls, trackTransitions, summarizeLlm, summarizeTts, summarizeDjLog, summarizeRequests, summarizeDebug } from '../stats.js';
import { queue } from '../broadcast/queue.js';
import { recentRequests } from '../broadcast/request-log.js';
import { budgetStatus } from '../broadcast/dj-budget.js';
import { PICKER_TOOLS } from '../llm/internal/tools/picker/index.js';

export const router = express.Router();

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const llm: any = summarizeLlm(recentCalls);
    llm.provider = llmProvider.providerName();
    llm.activeModel = llmProvider.activeModelLabel();
    // The DJ-agent deadline (admin-tunable, default 45s): past it the agent is
    // killed and falls back to the stateless pool picker. The dash latency gauge
    // anchors its redline to this so "red" means "hitting fallbacks", not an
    // arbitrary ceiling. Mirror of agentDeadline() in broadcast/dj-agent.ts.
    llm.agentTimeoutMs = settings.get().llm?.agentTimeoutMs ?? 45000;
    // Daily token budget — today's usage vs the cap + the resulting tier. Unlike
    // the rollups above (the 120-call ring, lost on restart) this is the durable
    // per-UTC-day tally. `enabled:false` when no cap is set.
    llm.budget = budgetStatus();

    // The skill loader imports the queue, which is itself part of controller
    // boot. Resolve it only for this admin request to avoid making /stats a
    // startup-cycle edge while still reflecting live skill rescans.
    const { loadedCapabilities } = await import('../skills/loader.js');
    res.json({
      t: new Date().toISOString(),
      llm,
      tts: summarizeTts(ttsCalls),
      djLog: summarizeDjLog(queue.djLog),
      requests: summarizeRequests(recentRequests),
      debug: summarizeDebug(toolCalls, trackTransitions, [
        ...PICKER_TOOLS.map(tool => tool.name),
        ...loadedCapabilities()
          .filter(cap => typeof cap.toolFn === 'function' && typeof cap.toolName === 'string')
          .map(cap => cap.toolName),
      ]),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
