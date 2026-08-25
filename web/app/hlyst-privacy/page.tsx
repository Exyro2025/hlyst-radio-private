export const metadata = { title: 'Privacy Policy — HLYST Radio' };

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

export default function PrivacyPage() {
  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh', color: IVORY, maxWidth: 720, margin: '0 auto' }}>
      <a href="/" style={{ color: GOLD, fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 0.25rem' }}>HLYST Radio Privacy Policy</h1>
      <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 2.5rem' }}>Effective: August 2026</p>

      <Section>
        <p>
          HLYST Radio, a property of JH Broadcast Group, respects the privacy of its listeners,
          visitors, artists, guests, and community.
        </p>
      </Section>

      <Section title="Information We May Collect">
        <p>
          When you use HLYST Radio, we may collect limited technical information necessary to
          operate, secure, and improve the website and listening experience, including browser
          or device information, general usage information, and interactions with site features.
        </p>
        <p>
          If you voluntarily use interactive features such as Talk Wave, contact forms, requests,
          contests, surveys, or other listener participation tools, we may also receive
          information you choose to provide, including your name or alias, email address,
          written message, voice recording, or other submitted content.
        </p>
      </Section>

      <Section title="Talk Wave">
        <p>
          Talk Wave allows listeners to interact with HLYST through features that may include
          written messages, voice notes, and, when available, telephone calls.
        </p>
        <p>
          By voluntarily submitting a message or voice note through Talk Wave, you understand
          that your submission may be reviewed by HLYST personnel for moderation and potential
          use in connection with HLYST programming.
        </p>
        <p>
          HLYST will provide appropriate notice and consent procedures before any telephone
          call-recording functionality is activated.
        </p>
      </Section>

      <Section title="Cookies and Similar Technologies">
        <p>
          HLYST may use cookies, local browser storage, or similar technologies where necessary
          to operate site functionality, remember preferences, maintain saved +Lyst This
          selections, measure site performance, prevent abuse, or improve the listener
          experience.
        </p>
      </Section>

      <Section title="Analytics">
        <p>
          HLYST may use analytics to understand general audience behavior, including page
          visits, listening activity, feature usage, and site performance.
        </p>
        <p>
          Analytics information is used to operate and improve HLYST and is not intended to
          publicly identify individual listeners.
        </p>
      </Section>

      <Section title="Third-Party Services">
        <p>
          HLYST may rely on third-party technology providers for services such as audio
          streaming, hosting, analytics, storage, communications, and other infrastructure.
        </p>
        <p>
          Those providers may process limited information necessary to provide their services
          and may maintain their own privacy policies.
        </p>
      </Section>

      <Section title="Information Sharing">
        <p>HLYST does not sell listener personal information.</p>
        <p>
          Information may be shared with service providers when necessary to operate HLYST,
          comply with applicable law, protect HLYST or its users, investigate misuse, or
          maintain the security and integrity of the service.
        </p>
      </Section>

      <Section title="Submitted Content">
        <p>
          Content voluntarily submitted through HLYST interactive features may be reviewed,
          moderated, archived, rejected, or selected for programming use consistent with the
          applicable submission terms and notices presented when the content is submitted.
        </p>
      </Section>

      <Section title="Data Security">
        <p>
          HLYST uses reasonable administrative and technical measures designed to protect
          information under its control. No internet-based service can guarantee absolute
          security.
        </p>
      </Section>

      <Section title="Your Choices">
        <p>You may choose not to provide optional personal information or participate in interactive features.</p>
        <p>Questions concerning personal information or privacy may be submitted through the HLYST Contact page.</p>
      </Section>

      <Section title="Changes to This Policy">
        <p>
          HLYST may update this Privacy Policy as its services evolve. The effective date
          displayed on this page will identify the current version.
        </p>
      </Section>

      <p style={{ color: '#888', fontSize: '0.85rem', margin: '2.5rem 0 0' }}>
        HLYST Radio is a JH Broadcast Group property.
      </p>
    </div>
  );
}
