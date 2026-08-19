// src/views/PrivacyPage.jsx
//
// Public Privacy Policy, reachable from the login disclaimer, the landing-page
// footer, and the Terms page. Styles are scoped under .sw-privacy so nothing
// leaks into the app's global stylesheet.
//
// ⚠️ IMPORTANT (for the Steadwerk team, not end users): this is a starting
// template, not legal advice. Have a licensed attorney review it before relying
// on it, especially the rights, retention, and international-transfer sections,
// which change with jurisdiction.
//
// WHAT IS NOT A GUESS
//
// The disclosures below were written from the code, not from a template. Every
// category, bucket and sub-processor named here was verified in this repo:
//
//   Fields        profiles (email, full_name, phone_number, active_company_id),
//                 memberships, audit_logs, team_chat_messages, jobs,
//                 maintenance_requests, vehicle_inspections, inventory_counts
//   Buckets       vehicle-photos, inventory-photos, job-attachments,
//                 vehicle-attachments, inventory-attachments, training-media
//   Processors    Supabase, Netlify, Stripe, Resend, Anthropic, AccuLynx,
//                 Open-Meteo (netlify/functions/*)
//   Local storage mrr_remember_email, sw_lang, the theme preference, and the
//                 Supabase session
//   Retention     audit logs are deleted after 30 days by
//                 archive_old_audit_logs() in supabase/03_functions.sql
//
// A grep for analytics, advertising and session-replay SDKs (GA, gtag, Segment,
// Mixpanel, Amplitude, Hotjar, Meta, PostHog, Sentry, Datadog) returns nothing,
// which is why section 05 can make that claim plainly.
//
// IF YOU CHANGE WHAT THE APP COLLECTS, CHANGE THIS PAGE. It is also the source
// for Apple's App Privacy questionnaire, and an answer there that contradicts
// this page is grounds for removal from the App Store.
import { useEffect, useRef } from "react";

const EFFECTIVE_DATE = "August 19, 2026";
const CONTACT_EMAIL = "privacy@steadwerk.com";

const CSS = `
.sw-privacy {
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
  .sw-privacy {
    --ground:#191D21; --surface:#20242A; --surface-2:#2B3137;
    --ink:#ECE6DA; --ink-soft:#B7BEC5; --muted:#8A929A;
    --line:rgba(237,230,218,.14); --line-2:rgba(237,230,218,.24);
    --accent:#DB9550; --accent-deep:#E7A968;
    --bar-1:#2A2F35; --bar-2:#20242A;
  }
}
.sw-privacy, .sw-privacy *, .sw-privacy *::before, .sw-privacy *::after { box-sizing:border-box; }
.sw-privacy .wrap { width:100%; max-width:900px; margin:0 auto; padding:0 calc(24px + var(--safe-right)) 0 calc(24px + var(--safe-left)); }
.sw-privacy .mono { font-family:"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.sw-privacy a { color:var(--accent-deep); text-decoration:underline; text-underline-offset:2px; }
.sw-privacy a:hover { color:var(--accent); }
.sw-privacy :focus-visible { outline:2.5px solid var(--accent); outline-offset:3px; border-radius:2px; }

/* top bar */
.sw-privacy .bar {
  position:sticky; top:0; z-index:20; color:var(--on-dark);
  /* Clears the iOS status bar in the installed app. Padding rather than a margin
     so the bar's own gradient fills the notch. 0px everywhere else. */
  padding-top:var(--safe-top);
  background:radial-gradient(ellipse at 50% -60%, var(--bar-1), var(--bar-2));
  border-bottom:1px solid rgba(0,0,0,.2);
}
.sw-privacy .bar-in { display:flex; align-items:center; justify-content:space-between; gap:16px; height:60px; }
.sw-privacy .brand { display:flex; align-items:center; gap:10px; }
.sw-privacy .brand .wm { font-family:"Space Grotesk", sans-serif; font-weight:700; font-size:18px; letter-spacing:.06em; color:var(--on-dark); }
.sw-privacy .mk-rect { fill:var(--on-dark); }
.sw-privacy .mk-stroke { stroke:var(--accent); }
.sw-privacy .back {
  display:inline-flex; align-items:center; gap:7px; cursor:pointer;
  background:transparent; border:1px solid rgba(237,230,218,.3); color:var(--on-dark);
  font-family:"Space Grotesk", sans-serif; font-weight:600; font-size:14px;
  padding:8px 15px; border-radius:3px; transition:border-color .18s, background .18s;
}
.sw-privacy .back:hover { border-color:var(--accent); background:rgba(237,230,218,.06); }

/* title block */
.sw-privacy .head { padding:clamp(40px,7vw,72px) 0 clamp(28px,4vw,40px); border-bottom:1px solid var(--line); }
.sw-privacy .eyebrow { font-family:"IBM Plex Mono", monospace; font-size:11.5px; font-weight:600; letter-spacing:.22em; text-transform:uppercase; color:var(--accent-deep); }
.sw-privacy h1 { font-family:"Space Grotesk", sans-serif; font-weight:700; letter-spacing:-.02em; font-size:clamp(32px,5vw,50px); line-height:1.04; margin:16px 0 0; color:var(--ink); text-wrap:balance; }
.sw-privacy .dates { margin-top:18px; display:flex; gap:22px; flex-wrap:wrap; font-family:"IBM Plex Mono", monospace; font-size:12px; letter-spacing:.04em; color:var(--muted); }
.sw-privacy .dates b { color:var(--ink-soft); font-weight:600; }
.sw-privacy .lede { margin-top:22px; font-size:17.5px; color:var(--ink-soft); max-width:66ch; }

/* toc */
.sw-privacy .toc { padding:clamp(28px,4vw,40px) 0; border-bottom:1px solid var(--line); }
.sw-privacy .toc h2 { font-family:"IBM Plex Mono", monospace; font-size:11.5px; font-weight:600; letter-spacing:.2em; text-transform:uppercase; color:var(--muted); margin:0 0 18px; }
.sw-privacy .toc ol { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:8px 32px; }
@media (max-width:640px){ .sw-privacy .toc ol { grid-template-columns:1fr; } }
.sw-privacy .toc a { display:flex; gap:12px; align-items:baseline; text-decoration:none; color:var(--ink); font-size:15px; padding:3px 0; }
.sw-privacy .toc a:hover { color:var(--accent-deep); }
.sw-privacy .toc a .num { font-family:"IBM Plex Mono", monospace; font-size:12px; color:var(--accent-deep); flex:0 0 auto; }

/* sections */
.sw-privacy .body { padding:clamp(32px,5vw,56px) 0 20px; }
.sw-privacy section.sec { padding:26px 0; border-top:1px solid var(--line); scroll-margin-top:76px; }
.sw-privacy section.sec:first-child { border-top:none; }
.sw-privacy .sec-h { display:flex; gap:14px; align-items:baseline; margin-bottom:14px; }
.sw-privacy .sec-h .num { font-family:"IBM Plex Mono", monospace; font-size:13px; font-weight:600; color:var(--accent); letter-spacing:.08em; flex:0 0 auto; padding-top:3px; }
.sw-privacy .sec-h h2 { font-family:"Space Grotesk", sans-serif; font-weight:700; letter-spacing:-.01em; font-size:clamp(20px,2.6vw,25px); margin:0; color:var(--ink); }
.sw-privacy .sec p { margin:0 0 14px; max-width:74ch; }
.sw-privacy .sec p:last-child, .sw-privacy .sec ul:last-child, .sw-privacy .sec ol:last-child { margin-bottom:0; }
.sw-privacy .sec ul, .sw-privacy .sec ol { margin:0 0 14px; padding-left:0; list-style:none; max-width:74ch; }
.sw-privacy .sec li { position:relative; padding-left:26px; margin-bottom:9px; }
.sw-privacy .sec ul li::before { content:""; position:absolute; left:6px; top:11px; width:6px; height:6px; background:var(--accent); }
.sw-privacy .sec ol { counter-reset:sw-li; }
.sw-privacy .sec ol li { counter-increment:sw-li; }
.sw-privacy .sec ol li::before { content:"(" counter(sw-li, lower-alpha) ")"; position:absolute; left:0; top:0; font-family:"IBM Plex Mono", monospace; font-size:13px; color:var(--accent-deep); }
.sw-privacy .sec b, .sw-privacy .sec strong { font-weight:600; color:var(--ink); }
.sw-privacy .callout { background:var(--surface); border:1px solid var(--line-2); border-left:3px solid var(--accent); border-radius:4px; padding:16px 20px; }
.sw-privacy .callout p { font-weight:600; color:var(--ink); }

/* processor table */
.sw-privacy .tbl-wrap { overflow-x:auto; margin:0 0 14px; }
.sw-privacy table { border-collapse:collapse; width:100%; min-width:520px; font-size:15px; }
.sw-privacy th, .sw-privacy td { text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:top; }
.sw-privacy th { font-family:"IBM Plex Mono", monospace; font-size:11.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:600; }
.sw-privacy td b { font-weight:600; color:var(--ink); }

/* footer */
.sw-privacy .foot { border-top:1px solid var(--line); background:var(--surface); }
.sw-privacy .foot-in { padding:30px 0 calc(44px + var(--safe-bottom)); display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; align-items:center; }
.sw-privacy .foot .tag { font-family:"IBM Plex Mono", monospace; font-size:11px; letter-spacing:.08em; color:var(--muted); }
.sw-privacy .foot .to-top { background:none; border:none; cursor:pointer; color:var(--accent-deep); font-family:"Space Grotesk", sans-serif; font-weight:600; font-size:14px; }
.sw-privacy .foot .to-top:hover { color:var(--accent); }
`;

const Badge = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect className="mk-rect" x="4" y="4" width="56" height="56" rx="10" />
    <path className="mk-stroke" d="M14 20 L22 44 L32 24 L42 44 L50 20" fill="none" strokeWidth="5" strokeLinecap="square" />
  </svg>
);

// Every section in one place so the table of contents and the body can never
// drift apart. Both are generated from this list.
const SECTIONS = [
  {
    id: "who",
    title: "Who this covers",
    body: (
      <>
        <p>
          Steadwerk is warehouse and fleet software sold to companies. Almost everyone who uses it does so because
          their employer bought it, not because they signed up themselves.
        </p>
        <p>
          That shapes this whole page. Your employer decides who gets an account, what role you hold, and what
          happens to your records when you leave. They control the data in their account. We hold it for them and
          run the service.
        </p>
        <p>
          If you are an employee with a question about your own records, your company administrator can answer it
          faster than we can. If you are the company, this page describes what we do with what you put in.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <p>Everything below is either something you type in or something the app records as you work.</p>
        <ul>
          <li>
            <b>Your account.</b> Name, work email, the role your administrator gave you, and which company you
            belong to. A mobile number, only if you add one so the app can reach you about alerts.
          </li>
          <li>
            <b>Sign-in.</b> Your password, stored only as a cryptographic hash that cannot be reversed back into
            the password. If you turn on two-factor authentication, the secret for your authenticator app.
          </li>
          <li>
            <b>Work records.</b> Jobs, purchase order numbers, job site addresses, schedules, contract values,
            notes, inventory items and counts, suppliers and prices, vehicles, trailers, mileage, service history,
            maintenance requests, and inspections.
          </li>
          <li>
            <b>Photos and files.</b> Job before and after photos, vehicle and product photos, inspection and
            maintenance photos, chat attachments, training media, and your company logo.
          </li>
          <li>
            <b>Team chat.</b> Messages you send inside the app, their attachments, and which messages you have
            read.
          </li>
          <li>
            <b>Activity history.</b> An audit trail of actions taken in your company account: what changed, who
            changed it, and when. This exists so an inventory or cost discrepancy can be traced. See section 07
            for how long it is kept.
          </li>
          <li>
            <b>Billing.</b> Your plan, seat count, and subscription status. Card details go straight to Stripe and
            never reach our servers or our database.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "not-collect",
    title: "What we do not collect",
    body: (
      <>
        <p>Stated plainly, because these are the things people reasonably assume software like this does.</p>
        <ul>
          <li>
            <b>We do not track your location.</b> The app shows weather for a fixed set of coordinates your
            company configures. It never reads your device location, and there is no GPS, geofencing, or crew
            tracking anywhere in the product.
          </li>
          <li>
            <b>We run no analytics or advertising.</b> There is no Google Analytics, no Meta pixel, no Segment,
            Mixpanel, Amplitude, Hotjar, or session replay. No third party receives a record of your visit,
            because no such third party is loaded.
          </li>
          <li>
            <b>We do not use advertising cookies.</b> The app stores only what it needs to work: your session, your
            language and theme choice, and your email address if you ticked the box asking it to be remembered.
          </li>
          <li>
            <b>We do not sell or rent personal information</b>, and we do not share it for advertising.
          </li>
          <li>
            <b>The camera and photo library are only opened when you tap to add a photo.</b> Nothing is captured in
            the background.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use it",
    body: (
      <>
        <p>We use what we hold to run the service you are paying for, and for very little else.</p>
        <ul>
          <li>Operating the product: showing your jobs, inventory, fleet and reports, and saving your changes.</li>
          <li>Signing you in and keeping other companies out of your account.</li>
          <li>Sending you the notifications the app is built to send, such as a job assignment or a maintenance update.</li>
          <li>Billing your company and keeping your seat count correct.</li>
          <li>Supporting you when you ask us for help, and diagnosing faults when something breaks.</li>
          <li>Keeping the audit trail your company relies on to reconcile stock and job costs.</li>
        </ul>
        <p>
          We do not use your business records to train machine learning models, and we do not use them to build a
          profile of you.
        </p>
      </>
    ),
  },
  {
    id: "who-sees",
    title: "Who can see your data",
    body: (
      <>
        <p>
          Every record in Steadwerk belongs to exactly one company, and the database enforces that separation
          itself rather than trusting the app to remember. One company cannot read another's jobs, inventory,
          people, or photos.
        </p>
        <p>Inside your company, what you can see depends on the role and permissions your administrator sets.</p>
        <p>
          A small number of Steadwerk staff can access company accounts to provide support, investigate a fault, or
          keep the service running. That access is recorded, and when a Steadwerk administrator enters a customer
          account the app displays a visible banner for the duration so it is never invisible to you.
        </p>
      </>
    ),
  },
  {
    id: "processors",
    title: "Companies we rely on",
    body: (
      <>
        <p>
          Steadwerk is built on services run by other companies. Each one below receives only what it needs to do
          its job, and none of them are permitted to use your data for their own purposes.
        </p>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Service</th><th>What it does</th><th>What it receives</th></tr>
            </thead>
            <tbody>
              <tr><td><b>Supabase</b></td><td>Database, sign-in, and file storage</td><td>Everything described in section 02</td></tr>
              <tr><td><b>Netlify</b></td><td>Hosting and server functions</td><td>Requests made by the app as you use it</td></tr>
              <tr><td><b>Stripe</b></td><td>Subscription payments</td><td>Billing contact and card details, entered on Stripe's own page</td></tr>
              <tr><td><b>Resend</b></td><td>Sending email</td><td>The recipient's address and the message</td></tr>
              <tr><td><b>Anthropic</b></td><td>The in-app assistant</td><td>What you type to it, and the company records it looks up to answer</td></tr>
              <tr><td><b>AccuLynx</b></td><td>Job sync, only if your company connects it</td><td>Job and material details your company chooses to send</td></tr>
              <tr><td><b>Open-Meteo</b></td><td>Weather</td><td>Only the coordinates your company configured. No personal data.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="callout">
          <p>
            Two of these deserve a direct word. If you use the in-app assistant, what you type and the company
            records it needs to answer are sent to Anthropic to generate the reply. If your company connects
            AccuLynx, job data flows to AccuLynx under their terms, and that connection is your company's choice to
            make and to switch off.
          </p>
        </div>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <>
        <ul>
          <li>
            <b>Activity history is deleted after 30 days.</b> A scheduled job removes audit entries older than
            that, permanently and automatically.
          </li>
          <li>
            <b>Your work records stay until someone deletes them.</b> Jobs, inventory, vehicles and photos are your
            company's business records, and we do not remove them on a timer.
          </li>
          <li>
            <b>Your account lasts as long as your access does.</b> When an administrator removes you, your
            membership ends and you can no longer sign in.
          </li>
          <li>
            <b>Your name may remain on work you did.</b> Records such as a stock receipt keep the name of the
            person who entered them, so history stays readable after they leave. This is deliberate: an inventory
            trail that says nothing about who received a delivery cannot be reconciled.
          </li>
          <li>
            <b>When a company closes its account</b>, its data is removed. Some copies may persist briefly in
            encrypted backups before those expire.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect it",
    body: (
      <>
        <ul>
          <li>Traffic between your device and Steadwerk is encrypted in transit, and data is encrypted at rest.</li>
          <li>Separation between companies is enforced by the database, not only by the app.</li>
          <li>Two-factor authentication is available, and once you enable it the app requires it on every sign-in.</li>
          <li>Passwords are stored only as hashes. Nobody at Steadwerk can read your password.</li>
          <li>Integration keys your company enters are held apart from ordinary settings so that only administrators can reach them.</li>
        </ul>
        <p>
          No system is perfectly secure, and we will not pretend otherwise. If a breach affects your data we will
          notify affected companies without undue delay.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your choices and rights",
    body: (
      <>
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>See what personal information we hold about you.</li>
          <li>Correct it if it is wrong. You can edit your own name, email and phone number in your profile at any time.</li>
          <li>Ask for it to be deleted.</li>
          <li>Ask for a copy in a portable format.</li>
          <li>Object to or restrict certain uses.</li>
        </ul>
        <p>
          Because your employer controls their account, we will usually direct a request about work records to them
          and help them answer it. Write to us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will respond within the time your law
          allows. We will not treat you differently for asking.
        </p>
      </>
    ),
  },
  {
    id: "mobile",
    title: "The mobile app",
    body: (
      <>
        <p>The Steadwerk app collects nothing beyond what the website collects. Two things are worth stating.</p>
        <ul>
          <li>
            <b>Camera and photo access.</b> The app asks permission the first time you attach a photo. It is used
            only at that moment, for that photo. Declining leaves every other part of the app working. You can
            change your mind later in your device settings.
          </li>
          <li>
            <b>No purchases in the app.</b> Subscriptions are bought and managed on the Steadwerk website by a
            company administrator. The app signs you in to an account that already exists.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        Steadwerk is a workplace tool for adults and is not directed to children. We do not knowingly collect
        information from anyone under 16. If you believe a child has been given an account, contact us and we will
        remove it.
      </p>
    ),
  },
  {
    id: "international",
    title: "Where your data is held",
    body: (
      <p>
        Steadwerk is operated from the United States, and the services in section 06 process and store data there.
        If you use Steadwerk from another country, you are sending your information to the United States, where
        privacy law differs from your own.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        When this policy changes we update the date at the top of the page. If a change materially affects how we
        handle personal information, we will tell affected companies directly rather than relying on you to notice.
        Continuing to use Steadwerk after a change means you accept the updated policy.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact us",
    body: (
      <>
        <p>Questions about this policy, or about your information, go to:</p>
        <p className="mono">
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <br />
          Steadwerk, Fort Wayne, Indiana, United States
        </p>
        <p>
          If you are an employee asking about your own work records, your company administrator can usually help
          you faster.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage({ onBack }) {
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
    <div className="sw-privacy" ref={rootRef}>
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
          <h1>Privacy Policy</h1>
          <div className="dates">
            <span><b>Effective:</b> {EFFECTIVE_DATE}</span>
            <span><b>Last updated:</b> {EFFECTIVE_DATE}</span>
          </div>
          <p className="lede">
            What Steadwerk collects, why, who else sees it, and how long we keep it. Written to be read, not to be
            skipped.
          </p>
        </div>

        <nav className="toc" aria-label="Contents">
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
