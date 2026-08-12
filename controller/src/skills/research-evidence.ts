// Source-neutral factual evidence exchanged between research adapters and the
// Producer/Persona pipeline. Adapters keep provenance here; Persona receives a
// deliberately smaller view containing only controller-approved statements.

export const RESEARCH_EVIDENCE_FORMAT = 'subwave.research-evidence.v1' as const;

export interface ResearchSubject {
  artist: string;
  title?: string;
}

export interface ResearchSource {
  id: string;
  provider: string;
  label: string;
  url?: string;
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

function cleanSubject(subject: ResearchSubject): ResearchSubject {
  const artist = String(subject?.artist || '').trim();
  const title = String(subject?.title || '').trim();
  return title ? { artist, title } : { artist };
}

// Reject malformed provenance rather than letting an adapter accidentally
// create a claim whose cited source is absent from the packet.
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

export function isResearchEvidence(value: unknown): value is ResearchEvidence {
  return !!value && typeof value === 'object'
    && (value as { format?: unknown }).format === RESEARCH_EVIDENCE_FORMAT;
}

// URLs, snippets, provider names and retrieval mechanics are not creative
// context. Persona gets the subject and approved facts only.
export function personaResearchEvidence(value: unknown): unknown {
  if (!isResearchEvidence(value) || !value.available) return value;
  return {
    subject: value.subject,
    facts: value.claims.map((claim) => claim.text),
  };
}
