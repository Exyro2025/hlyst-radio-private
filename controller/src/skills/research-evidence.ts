// Source-neutral evidence returned by specialist research adapters. The
// speaking model gets explicit claims tied to explicit sources instead of raw
// neighbouring search snippets from which it could invent a relationship.

export const RESEARCH_EVIDENCE_FORMAT = 'subwave.research-evidence.v1' as const;

export interface ResearchSubject {
  artist?: string;
  title?: string;
  topic?: string;
}

export interface ResearchSource {
  id: string;
  provider: string;
  label: string;
  url?: string;
  publishedAt?: string;
  retrievedAt?: string;
}

export interface ResearchClaim {
  text: string;
  sourceIds: string[];
  topic?: string;
}

export interface AvailableResearchEvidence {
  format: typeof RESEARCH_EVIDENCE_FORMAT;
  available: true;
  subject: ResearchSubject;
  claims: ResearchClaim[];
  sources: ResearchSource[];
}

export interface UnavailableResearchEvidence {
  format: typeof RESEARCH_EVIDENCE_FORMAT;
  available: false;
  subject: ResearchSubject;
  reason: string;
}

export type ResearchEvidence = AvailableResearchEvidence | UnavailableResearchEvidence;

function cleanSubject(subject: ResearchSubject): ResearchSubject {
  const artist = String(subject?.artist || '').trim();
  const title = String(subject?.title || '').trim();
  const topic = String(subject?.topic || '').trim();
  return {
    ...(artist ? { artist } : {}),
    ...(title ? { title } : {}),
    ...(topic ? { topic } : {}),
  };
}

export function unavailableResearchEvidence(
  subject: ResearchSubject,
  reason: string,
): UnavailableResearchEvidence {
  return {
    format: RESEARCH_EVIDENCE_FORMAT,
    available: false,
    subject: cleanSubject(subject),
    reason: String(reason || 'no supported claim').trim(),
  };
}

export function createResearchEvidence({
  subject,
  claims,
  sources,
}: {
  subject: ResearchSubject;
  claims: ResearchClaim[];
  sources: ResearchSource[];
}): ResearchEvidence {
  const cleanedSources = (sources || []).map((source) => ({
    id: String(source?.id || '').trim(),
    provider: String(source?.provider || '').trim(),
    label: String(source?.label || '').trim(),
    ...(source?.url ? { url: String(source.url).trim() } : {}),
    ...(source?.publishedAt ? { publishedAt: String(source.publishedAt).trim() } : {}),
    ...(source?.retrievedAt ? { retrievedAt: String(source.retrievedAt).trim() } : {}),
  })).filter((source) => source.id && source.provider && source.label);
  const sourceIds = new Set(cleanedSources.map((source) => source.id));
  const cleanedClaims = (claims || []).map((claim) => ({
    text: String(claim?.text || '').trim(),
    sourceIds: [...new Set((claim?.sourceIds || []).map((id) => String(id).trim()))]
      .filter((id) => sourceIds.has(id)),
    ...(claim?.topic ? { topic: String(claim.topic).trim() } : {}),
  })).filter((claim) => claim.text && claim.sourceIds.length > 0);

  if (!cleanedClaims.length) {
    return unavailableResearchEvidence(subject, 'no claim has valid provenance');
  }
  const usedIds = new Set(cleanedClaims.flatMap((claim) => claim.sourceIds));
  return {
    format: RESEARCH_EVIDENCE_FORMAT,
    available: true,
    subject: cleanSubject(subject),
    claims: cleanedClaims,
    sources: cleanedSources.filter((source) => usedIds.has(source.id)),
  };
}
