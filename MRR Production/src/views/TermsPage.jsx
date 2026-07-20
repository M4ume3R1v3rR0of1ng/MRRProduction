// src/views/TermsPage.jsx
//
// Public Terms & Conditions page, reachable from the login disclaimer and the
// landing-page footer. Styles are scoped under .sw-terms so nothing leaks into
// the app's global stylesheet.
//
// ⚠️ IMPORTANT (for the Steadwerk team, not end users): the text below is a
// thorough starting template, not legal advice. Have a licensed attorney review
// and tailor it — especially the billing, liability, governing-law, and data
// sections — before relying on it. Keep the Effective date in sync when you edit.
import { useEffect, useRef } from "react";

const EFFECTIVE_DATE = "July 20, 2026";
const CONTACT_EMAIL = "legal@steadwerk.com";

const CSS = `
.sw-terms {
  --ground:#F6F3EC; --surface:#FFFFFF; --surface-2:#EDE6DA;
  --ink:#23282D; --ink-soft:#4E565D; --muted:#6E7780;
  --line:rgba(35,40,45,.14); --line-2:rgba(35,40,45,.28);
  --accent:#C97B2D; --accent-deep:#8A5A2B;
  --bar-1:#2F353C; --bar-2:#23282D; --on-dark:#EDE6DA; --on-dark-soft:rgba(237,230,218,.72);

  min-height:100vh; background:var(--ground); color:var(--ink);
  font-family:"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size:16.5px; line-height:1.72; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
@media (prefers-color-scheme: dark) {
  .sw-terms {
    --ground:#191D21; --surface:#20242A; --surface-2:#2B3137;
    --ink:#ECE6DA; --ink-soft:#B7BEC5; --muted:#8A929A;
    --line:rgba(237,230,218,.14); --line-2:rgba(237,230,218,.24);
    --accent:#DB9550; --accent-deep:#E7A968;
    --bar-1:#2A2F35; --bar-2:#20242A;
  }
}
.sw-terms, .sw-terms *, .sw-terms *::before, .sw-terms *::after { box-sizing:border-box; }
.sw-terms .wrap { width:100%; max-width:900px; margin:0 auto; padding:0 24px; }
.sw-terms .mono { font-family:"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.sw-terms a { color:var(--accent-deep); text-decoration:underline; text-underline-offset:2px; }
.sw-terms a:hover { color:var(--accent); }
.sw-terms :focus-visible { outline:2.5px solid var(--accent); outline-offset:3px; border-radius:2px; }

/* top bar */
.sw-terms .bar {
  position:sticky; top:0; z-index:20; color:var(--on-dark);
  background:radial-gradient(ellipse at 50% -60%, var(--bar-1), var(--bar-2));
  border-bottom:1px solid rgba(0,0,0,.2);
}
.sw-terms .bar-in { display:flex; align-items:center; justify-content:space-between; gap:16px; height:60px; }
.sw-terms .brand { display:flex; align-items:center; gap:10px; }
.sw-terms .brand .wm { font-family:"Space Grotesk", sans-serif; font-weight:700; font-size:18px; letter-spacing:.06em; color:var(--on-dark); }
.sw-terms .mk-rect { fill:var(--on-dark); }
.sw-terms .mk-stroke { stroke:var(--accent); }
.sw-terms .back {
  display:inline-flex; align-items:center; gap:7px; cursor:pointer;
  background:transparent; border:1px solid rgba(237,230,218,.3); color:var(--on-dark);
  font-family:"Space Grotesk", sans-serif; font-weight:600; font-size:14px;
  padding:8px 15px; border-radius:3px; transition:border-color .18s, background .18s;
}
.sw-terms .back:hover { border-color:var(--accent); background:rgba(237,230,218,.06); }

/* title block */
.sw-terms .head { padding:clamp(40px,7vw,72px) 0 clamp(28px,4vw,40px); border-bottom:1px solid var(--line); }
.sw-terms .eyebrow { font-family:"IBM Plex Mono", monospace; font-size:11.5px; font-weight:600; letter-spacing:.22em; text-transform:uppercase; color:var(--accent-deep); }
.sw-terms h1 { font-family:"Space Grotesk", sans-serif; font-weight:700; letter-spacing:-.02em; font-size:clamp(32px,5vw,50px); line-height:1.04; margin:16px 0 0; color:var(--ink); text-wrap:balance; }
.sw-terms .dates { margin-top:18px; display:flex; gap:22px; flex-wrap:wrap; font-family:"IBM Plex Mono", monospace; font-size:12px; letter-spacing:.04em; color:var(--muted); }
.sw-terms .dates b { color:var(--ink-soft); font-weight:600; }
.sw-terms .lede { margin-top:22px; font-size:17.5px; color:var(--ink-soft); max-width:66ch; }

/* toc */
.sw-terms .toc { padding:clamp(28px,4vw,40px) 0; border-bottom:1px solid var(--line); }
.sw-terms .toc h2 { font-family:"IBM Plex Mono", monospace; font-size:11.5px; font-weight:600; letter-spacing:.2em; text-transform:uppercase; color:var(--muted); margin:0 0 18px; }
.sw-terms .toc ol { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:8px 32px; }
@media (max-width:640px){ .sw-terms .toc ol { grid-template-columns:1fr; } }
.sw-terms .toc a { display:flex; gap:12px; align-items:baseline; text-decoration:none; color:var(--ink); font-size:15px; padding:3px 0; }
.sw-terms .toc a:hover { color:var(--accent-deep); }
.sw-terms .toc a .num { font-family:"IBM Plex Mono", monospace; font-size:12px; color:var(--accent-deep); flex:0 0 auto; }

/* sections */
.sw-terms .body { padding:clamp(32px,5vw,56px) 0 20px; }
.sw-terms section.sec { padding:26px 0; border-top:1px solid var(--line); scroll-margin-top:76px; }
.sw-terms section.sec:first-child { border-top:none; }
.sw-terms .sec-h { display:flex; gap:14px; align-items:baseline; margin-bottom:14px; }
.sw-terms .sec-h .num { font-family:"IBM Plex Mono", monospace; font-size:13px; font-weight:600; color:var(--accent); letter-spacing:.08em; flex:0 0 auto; padding-top:3px; }
.sw-terms .sec-h h2 { font-family:"Space Grotesk", sans-serif; font-weight:700; letter-spacing:-.01em; font-size:clamp(20px,2.6vw,25px); margin:0; color:var(--ink); }
.sw-terms .sec p { margin:0 0 14px; max-width:74ch; }
.sw-terms .sec p:last-child, .sw-terms .sec ul:last-child, .sw-terms .sec ol:last-child { margin-bottom:0; }
.sw-terms .sec ul, .sw-terms .sec ol { margin:0 0 14px; padding-left:0; list-style:none; max-width:74ch; }
.sw-terms .sec li { position:relative; padding-left:26px; margin-bottom:9px; }
.sw-terms .sec ul li::before { content:""; position:absolute; left:6px; top:11px; width:6px; height:6px; background:var(--accent); }
.sw-terms .sec ol { counter-reset:sw-li; }
.sw-terms .sec ol li { counter-increment:sw-li; }
.sw-terms .sec ol li::before { content:"(" counter(sw-li, lower-alpha) ")"; position:absolute; left:0; top:0; font-family:"IBM Plex Mono", monospace; font-size:13px; color:var(--accent-deep); }
.sw-terms .sec b, .sw-terms .sec strong { font-weight:600; color:var(--ink); }
.sw-terms .callout { background:var(--surface); border:1px solid var(--line-2); border-left:3px solid var(--accent); border-radius:4px; padding:16px 20px; }
.sw-terms .callout p { font-weight:600; color:var(--ink); }

/* footer */
.sw-terms .foot { border-top:1px solid var(--line); background:var(--surface); }
.sw-terms .foot-in { padding:30px 0 44px; display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; align-items:center; }
.sw-terms .foot .tag { font-family:"IBM Plex Mono", monospace; font-size:11px; letter-spacing:.08em; color:var(--muted); }
.sw-terms .foot .to-top { background:none; border:none; cursor:pointer; color:var(--accent-deep); font-family:"Space Grotesk", sans-serif; font-weight:600; font-size:14px; }
.sw-terms .foot .to-top:hover { color:var(--accent); }
`;

const Badge = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect className="mk-rect" x="4" y="4" width="56" height="56" rx="10" />
    <path className="mk-stroke" d="M14 20 L22 44 L32 24 L42 44 L50 20" fill="none" strokeWidth="5" strokeLinecap="square" />
  </svg>
);

// Every section in one place so the table of contents and the body can never
// drift apart — both are generated from this list.
const SECTIONS = [
  {
    id: "agreement",
    title: "Agreement to These Terms",
    body: (
      <>
        <p>
          These Terms and Conditions (the <b>“Terms”</b>) are a binding agreement between you and Steadwerk
          (<b>“Steadwerk,” “we,” “us,”</b> or <b>“our”</b>) governing your access to and use of the Steadwerk web
          application, websites, and related services (together, the <b>“Services”</b>). By creating an account,
          logging in, or otherwise accessing or using the Services, you agree to these Terms and to our Privacy
          Policy, which is incorporated by reference.
        </p>
        <p>
          If you are agreeing to these Terms on behalf of a company or other organization, you represent that you
          have authority to bind that entity, and <b>“you”</b> refers to that entity. If you do not agree to these
          Terms, do not access or use the Services.
        </p>
      </>
    ),
  },
  {
    id: "definitions",
    title: "Definitions",
    body: (
      <ul>
        <li><b>Account</b> — the credentials and profile that let an individual sign in to the Services.</li>
        <li><b>Workspace</b> — a company’s isolated tenant environment within the Services, containing that company’s inventory, jobs, fleet, users, and other data.</li>
        <li><b>Administrator</b> — a user granted an admin role for a Workspace, who manages members, roles, and settings.</li>
        <li><b>Authorized User</b> — an individual whom an Administrator has added to a Workspace and permitted to use the Services.</li>
        <li><b>Customer Data</b> — any data, content, or information that you or your Authorized Users submit to or generate within the Services.</li>
        <li><b>Subscription</b> — a paid plan that entitles a company to use the Services for a stated term.</li>
      </ul>
    ),
  },
  {
    id: "services",
    title: "The Services",
    body: (
      <>
        <p>
          Steadwerk provides cloud-based warehouse, inventory, fleet, and job-management software for small trades,
          service, and distribution businesses. Depending on your plan, the Services may include inventory tracking,
          job creation and close-out, fleet and maintenance management, crew and role management, reporting, and
          related tools, accessed through a web browser on a software-as-a-service basis.
        </p>
        <p>
          The Services are tools to help you run your business; they do not replace your own judgment. Figures the
          Services display — including inventory counts, job costs, and reports — depend on the data entered and the
          integrations you enable, and you are responsible for verifying anything you rely on for a business,
          financial, tax, or legal decision.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility, Accounts & Security",
    body: (
      <>
        <p>
          You must be at least 18 years old and able to form a binding contract to use the Services. Access to an
          existing company is granted by that company’s Administrator; there is no public self-registration for an
          existing Workspace.
        </p>
        <p>
          You are responsible for keeping your login credentials confidential and for all activity that occurs under
          your Account. Credentials are for a single named individual and may not be shared. Notify us promptly at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if you suspect any unauthorized use of your Account
          or Workspace.
        </p>
      </>
    ),
  },
  {
    id: "workspaces",
    title: "Company Workspaces & Multi-Tenancy",
    body: (
      <>
        <p>
          The Services are multi-tenant. Each company operates within its own Workspace, and access is governed by
          membership and role. You may access only the Workspaces you are authorized to access, and only in the role
          assigned to you.
        </p>
        <p>
          Administrators are responsible for managing their Workspace, including who is added, each member’s role and
          permissions, and the accuracy of the company’s configuration. Steadwerk is not responsible for actions
          taken by your Administrators or Authorized Users within your Workspace.
        </p>
      </>
    ),
  },
  {
    id: "ownership",
    title: "Ownership & License",
    body: (
      <>
        <p>
          As between the parties, Steadwerk and its licensors own all right, title, and interest in and to the
          Services, including all software, designs, user interfaces, text, graphics, the “Steadwerk” name and truss
          mark, and all related intellectual property rights.
        </p>
        <p>
          Subject to these Terms and your payment of applicable fees, we grant you a limited, non-exclusive,
          non-transferable, non-sublicensable, revocable license to access and use the Services for your internal
          business purposes during your Subscription term. No rights are granted to you except as expressly stated
          in these Terms.
        </p>
      </>
    ),
  },
  {
    id: "your-data",
    title: "Your Data & Customer Information",
    body: (
      <>
        <p>
          You retain ownership of your Customer Data. You grant Steadwerk a worldwide, non-exclusive, royalty-free
          license to host, store, process, transmit, and display Customer Data solely to provide, maintain, secure,
          support, and improve the Services and as otherwise permitted by these Terms and our Privacy Policy.
        </p>
        <p>
          You are responsible for the accuracy, quality, and legality of your Customer Data and for having all
          rights and consents needed to submit it, including any information about your own customers, employees, or
          vehicles. We maintain reasonable technical and organizational safeguards designed to protect Customer Data,
          but no method of transmission or storage is completely secure, and you are responsible for maintaining your
          own backups of information that is critical to you.
        </p>
        <p>
          We may generate and use aggregated or de-identified data derived from use of the Services (which does not
          identify you or any individual) to operate, analyze, and improve the Services.
        </p>
      </>
    ),
  },
  {
    id: "limits",
    title: "Usage Limits & Plan Scope",
    body: (
      <p>
        Your Subscription may include limits — for example, on the number of Authorized Users or seats, companies,
        storage, records, or feature availability — as described at the time of purchase or within the Services. You
        agree not to exceed or attempt to circumvent these limits. We may meter usage and, where usage exceeds your
        plan, require an upgrade or adjust fees on a prospective basis.
      </p>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use — Restrictions & Responsibilities",
    body: (
      <>
        <p>You agree not to, and not to permit any Authorized User or third party to:</p>
        <ol>
          <li>copy, modify, translate, or create derivative works of the Services;</li>
          <li>reverse engineer, decompile, or attempt to derive source code, except to the limited extent applicable law expressly permits;</li>
          <li>rent, lease, resell, sublicense, or provide the Services to third parties as a service bureau or on a timesharing basis;</li>
          <li>access or use the Services to build or improve a competing product or service;</li>
          <li>probe, scan, or test the vulnerability of, or breach or circumvent, any security or authentication measure;</li>
          <li>introduce malware or interfere with or disrupt the integrity or performance of the Services or the data they contain;</li>
          <li>use the Services in violation of any applicable law or regulation, or in a way that infringes or misappropriates the rights of others;</li>
          <li>access the Services through automated means (bots, scrapers) except through interfaces we document and authorize; or</li>
          <li>remove, obscure, or alter any proprietary notices in the Services.</li>
        </ol>
        <p>You are responsible for your Authorized Users’ compliance with these Terms and for all use of the Services under your Workspace.</p>
      </>
    ),
  },
  {
    id: "third-party",
    title: "Third-Party Materials & Integrations",
    body: (
      <>
        <p>
          The Services rely on and may interoperate with third-party products and services — for example, our payment
          processor, cloud hosting and infrastructure providers, email delivery, and optional integrations you choose
          to enable (such as AccuLynx). Those third-party materials are provided by their respective owners and are
          governed by the third party’s own terms and privacy policies.
        </p>
        <p>
          Enabling an integration may require you to authorize the exchange of data between the Services and the third
          party; you are responsible for that authorization and your use of the integration. Steadwerk does not
          control and is not responsible for third-party materials, and their availability may change without notice.
        </p>
      </>
    ),
  },
  {
    id: "billing",
    title: "Billing & Payment",
    body: (
      <>
        <p>
          Paid Subscriptions are billed in advance on a recurring basis (monthly or annually, as selected) through
          our third-party payment processor. By subscribing, you authorize us and our processor to charge your
          designated payment method for all applicable fees and taxes.
        </p>
        <ul>
          <li><b>Auto-renewal.</b> Subscriptions automatically renew for successive periods at the then-current rate unless cancelled before the renewal date.</li>
          <li><b>Non-refundable.</b> Except where required by law or expressly stated, fees are non-refundable, including for partial periods and unused capacity.</li>
          <li><b>Taxes.</b> Fees are exclusive of taxes; you are responsible for all sales, use, VAT, and similar taxes, other than taxes on our net income.</li>
          <li><b>Failed or overdue payment.</b> If a charge fails or an account is past due, we may suspend, limit, or downgrade the Services until payment is received.</li>
          <li><b>Price changes.</b> We may change fees, and will give reasonable advance notice; changes take effect on your next renewal.</li>
        </ul>
      </>
    ),
  },
  {
    id: "changes-service",
    title: "Right to Modify, Suspend, or Discontinue the Services",
    body: (
      <>
        <p>
          We are continually improving the Services and may modify, update, add, or remove features, or suspend or
          discontinue the Services (or any part of them) at any time. We will use reasonable efforts to give notice of
          material changes that adversely affect your use.
        </p>
        <p>
          We may also suspend or limit your access, in whole or in part, if we reasonably believe that (a) there is a
          security, legal, or operational risk; (b) you or an Authorized User is violating these Terms; or (c) your
          account is overdue. Except as expressly provided, Steadwerk is not liable to you for any modification,
          suspension, or discontinuation of the Services.
        </p>
      </>
    ),
  },
  {
    id: "feedback",
    title: "Feedback",
    body: (
      <p>
        If you choose to give us suggestions, ideas, or other feedback about the Services, you grant Steadwerk a
        perpetual, irrevocable, worldwide, royalty-free license to use and incorporate that feedback into the
        Services without restriction, attribution, or compensation to you.
      </p>
    ),
  },
  {
    id: "confidentiality",
    title: "Confidentiality",
    body: (
      <p>
        Each party may access non-public information of the other in connection with the Services. Each party agrees
        to use the other’s confidential information only as needed to exercise its rights and perform its obligations
        under these Terms, and to protect it with reasonable care. This does not apply to information that is or
        becomes public through no fault of the receiving party, was already known to it, or is independently
        developed or lawfully obtained from a third party.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <div className="callout">
        <p>
          The Services are provided “as is” and “as available,” without warranties of any kind, whether express,
          implied, or statutory, including any implied warranties of merchantability, fitness for a particular
          purpose, title, and non-infringement. Steadwerk does not warrant that the Services will be uninterrupted,
          timely, secure, or error-free, or that any data, count, cost, or report generated by the Services will be
          accurate or complete. You use the Services, and rely on their output, at your own risk.
        </p>
      </div>
    ),
  },
  {
    id: "liability",
    title: "Limitation of Liability",
    body: (
      <div className="callout">
        <p>
          To the maximum extent permitted by law, Steadwerk and its suppliers will not be liable for any indirect,
          incidental, special, consequential, exemplary, or punitive damages, or for any loss of profits, revenue,
          data, goodwill, or business, arising out of or relating to the Services or these Terms, even if advised of
          the possibility. Steadwerk’s total aggregate liability for all claims arising out of or relating to the
          Services or these Terms will not exceed the amounts you paid to Steadwerk for the Services in the twelve
          (12) months preceding the event giving rise to the claim. Some jurisdictions do not allow certain
          limitations, so some of the above may not apply to you.
        </p>
      </div>
    ),
  },
  {
    id: "indemnification",
    title: "Indemnification",
    body: (
      <p>
        You agree to defend, indemnify, and hold harmless Steadwerk and its officers, employees, and agents from and
        against any claims, damages, liabilities, losses, and expenses (including reasonable attorneys’ fees) arising
        out of or related to your Customer Data, your use of the Services, or your violation of these Terms or of any
        law or third-party right.
      </p>
    ),
  },
  {
    id: "termination",
    title: "Term & Termination",
    body: (
      <>
        <p>
          These Terms apply for as long as you use the Services. You may stop using the Services and cancel your
          Subscription at any time; cancellation takes effect at the end of the current billing period. We may suspend
          or terminate your access for material breach, non-payment, or as otherwise permitted by these Terms or
          required by law.
        </p>
        <p>
          Upon termination, your license to use the Services ends. We may delete Customer Data after a reasonable
          retention period. Before termination — or within a limited window afterward as described in our
          documentation — you may request an export of your Customer Data. Provisions that by their nature should
          survive termination (including ownership, confidentiality, disclaimers, limitation of liability,
          indemnification, and governing law) will survive.
        </p>
      </>
    ),
  },
  {
    id: "changes-terms",
    title: "Changes to These Terms",
    body: (
      <p>
        We may update these Terms from time to time. If we make material changes, we will provide notice by posting
        the updated Terms with a new Effective date and, where appropriate, by notifying you in-app or by email. Your
        continued use of the Services after the changes take effect constitutes your acceptance of the updated Terms.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "Governing Law & Disputes",
    body: (
      <p>
        These Terms are governed by the laws of the State of Indiana, without regard to its conflict-of-laws rules.
        The state and federal courts located in Allen County, Indiana (Fort Wayne) will have exclusive jurisdiction
        over any dispute arising out of or relating to these Terms or the Services, and you consent to personal
        jurisdiction and venue in those courts. Nothing in this section prevents either party from seeking injunctive
        relief to protect its intellectual property or confidential information.
      </p>
    ),
  },
  {
    id: "general",
    title: "General",
    body: (
      <ul>
        <li><b>Entire agreement.</b> These Terms, together with any plan or order details and our Privacy Policy, are the entire agreement between you and Steadwerk regarding the Services.</li>
        <li><b>Severability.</b> If any provision is found unenforceable, the rest remains in effect, and the unenforceable provision is limited or reformed to the minimum extent necessary.</li>
        <li><b>No waiver.</b> Our failure to enforce a provision is not a waiver of our right to do so later.</li>
        <li><b>Assignment.</b> You may not assign these Terms without our prior written consent; we may assign them to an affiliate or in connection with a merger, acquisition, or sale of assets.</li>
        <li><b>Force majeure.</b> Neither party is liable for delays or failures caused by events beyond its reasonable control.</li>
        <li><b>Relationship.</b> The parties are independent contractors; these Terms create no partnership, agency, or employment relationship, and there are no third-party beneficiaries.</li>
      </ul>
    ),
  },
  {
    id: "contact",
    title: "Contact Us",
    body: (
      <p>
        Questions about these Terms? Contact Steadwerk in Fort Wayne, Indiana at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    ),
  },
];

export default function TermsPage({ onBack }) {
  const rootRef = useRef(null);

  // Land at the top when the page opens.
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, []);

  const scrollTo = (id) => (e) => {
    e.preventDefault();
    const el = rootRef.current?.querySelector(`#${id}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const num = (i) => String(i + 1).padStart(2, "0");

  return (
    <div className="sw-terms" ref={rootRef}>
      <style>{CSS}</style>

      <header className="bar">
        <div className="wrap bar-in">
          <div className="brand">
            <Badge size={28} />
            <span className="wm">STEADWERK</span>
          </div>
          <button className="back" type="button" onClick={onBack}>← Back</button>
        </div>
      </header>

      <div className="wrap">
        <div className="head">
          <span className="eyebrow">Legal</span>
          <h1>Terms &amp; Conditions</h1>
          <div className="dates">
            <span><b>Effective:</b> {EFFECTIVE_DATE}</span>
            <span><b>Last updated:</b> {EFFECTIVE_DATE}</span>
          </div>
          <p className="lede">
            Please read these Terms carefully. They govern your use of Steadwerk and form a binding agreement between
            you and us. By logging in or using the Services, you agree to them.
          </p>
        </div>

        <nav className="toc" aria-label="Table of contents">
          <h2>Contents</h2>
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} onClick={scrollTo(s.id)}>
                  <span className="num">{num(i)}</span>
                  <span>{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="body">
          {SECTIONS.map((s, i) => (
            <section className="sec" id={s.id} key={s.id}>
              <div className="sec-h">
                <span className="num">{num(i)}</span>
                <h2>{s.title}</h2>
              </div>
              {s.body}
            </section>
          ))}
        </div>
      </div>

      <footer className="foot">
        <div className="wrap foot-in">
          <span className="tag">STEADWERK · FORT WAYNE, IN · WORK RUNS STEADY.</span>
          <button className="to-top" type="button" onClick={toTop}>Back to top ↑</button>
        </div>
      </footer>
    </div>
  );
}
