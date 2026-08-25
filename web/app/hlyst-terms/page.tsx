export const metadata = { title: 'Terms of Use — HLYST Radio' };

const GOLD = '#c9a44c';
const IVORY = '#f5f0e8';

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      {title && <h2 style={{ color: GOLD, fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>{title}</h2>}
      <div style={{ color: '#ccc', fontSize: '0.95rem', lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

export default function TermsPage() {
  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh', color: IVORY, maxWidth: 720, margin: '0 auto' }}>
      <a href="/" style={{ color: GOLD, fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 0.25rem' }}>HLYST Radio Terms of Use</h1>
      <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 2.5rem' }}>Effective: August 2026</p>

      <Section>
        <p>By accessing or using HLYST Radio, you agree to these Terms of Use.</p>
      </Section>

      <Section title="HLYST Programming">
        <p>
          HLYST provides digital radio programming, music discovery, editorial content,
          interviews, cultural programming, and listener-interaction experiences.
        </p>
        <p>Programming, scheduling, features, availability, and content may change without notice.</p>
      </Section>

      <Section title="Intellectual Property">
        <p>
          Unless otherwise indicated, the HLYST name, branding, website design, original written
          material, station imaging, graphics, programming concepts, and other original HLYST
          materials are owned by or licensed to JH Broadcast Group and may not be reproduced,
          distributed, republished, or commercially exploited without authorization.
        </p>
        <p>
          Music, photographs, recordings, trademarks, and other third-party materials remain the
          property of their respective rights holders.
        </p>
      </Section>

      <Section title="Listener Submissions">
        <p>
          When you voluntarily submit a message, request, voice note, comment, or other material
          to HLYST, you represent that you have the right to submit that material.
        </p>
        <p>You retain ownership of content you create.</p>
        <p>
          By submitting content specifically for interaction with HLYST programming, you grant
          HLYST and JH Broadcast Group a non-exclusive permission to review, moderate, reproduce,
          edit for length or technical requirements, and use the submission in connection with
          HLYST programming, promotion, and related digital channels, subject to any additional
          notice presented at submission.
        </p>
        <p>HLYST is not obligated to publish, broadcast, acknowledge, or retain any submission.</p>
      </Section>

      <Section title="Community Standards">
        <p>
          Do not use HLYST interactive services to submit unlawful, threatening, harassing,
          defamatory, infringing, fraudulent, malicious, abusive, or deliberately disruptive
          material.
        </p>
        <p>
          HLYST may reject or remove submissions and restrict access to interactive features when
          reasonably necessary to protect the station, its audience, or its services.
        </p>
      </Section>

      <Section title="Talk Wave">
        <p>Talk Wave is a moderated listener-participation platform.</p>
        <p>
          Submission of a message, voice note, or call does not guarantee that it will be read,
          played, answered, or placed on air.
        </p>
        <p>
          Where telephone calling or recording is offered, additional disclosures or consent
          requirements may apply before participation.
        </p>
      </Section>

      <Section title="Music Requests and +Lyst This">
        <p>A music request is a request only and does not guarantee airplay.</p>
        <p>
          +Lyst This is a listener discovery/saving feature and does not constitute a request
          for airplay, purchase, endorsement, vote, or guarantee of programming consideration.
        </p>
      </Section>

      <Section title="Editorial Independence">
        <p>
          HLYST maintains editorial discretion over The Lyst, interviews, reviews,
          recommendations, programming, and other editorial features.
        </p>
        <p>Commercial relationships do not automatically confer editorial recognition or approval.</p>
        <p style={{ color: GOLD }}>Earned Not Bought.</p>
      </Section>

      <Section title="Availability">
        <p>
          HLYST does not guarantee uninterrupted availability of its website, stream,
          programming, metadata, interactive services, or third-party services.
        </p>
        <p>
          Temporary interruptions may occur because of maintenance, network conditions, provider
          outages, or circumstances outside HLYST's control.
        </p>
      </Section>

      <Section title="External Services">
        <p>
          HLYST may link to or integrate third-party platforms. HLYST is not responsible for the
          independent content, policies, security, or practices of those third parties.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          These Terms may be updated as HLYST's services and features evolve. Continued use
          after updated Terms become effective constitutes acceptance of the revised Terms.
        </p>
      </Section>

      <Section title="Contact">
        <p>Questions regarding these Terms may be submitted through the HLYST Contact page.</p>
      </Section>

      <p style={{ color: '#888', fontSize: '0.85rem', margin: '2.5rem 0 0' }}>
        HLYST Radio is a JH Broadcast Group property.
      </p>
    </div>
  );
}
