import { LEGAL } from "../../lib/legal";

export const metadata = { title: "Privacy Policy — Market Tide" };

export default function Privacy() {
  return (
    <div className="wrap legal">
      <a className="back" href="/">← Market Tide</a>
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated {LEGAL.updated}</p>

      <p className="callout">
        <strong>The short version.</strong> We ask for your email, and your
        WhatsApp number only if you offer it. We use them to send you the thing
        you signed up for. We do not sell them, and we never see your card
        details.
      </p>

      <h2>1. Who is responsible</h2>
      <p>
        {LEGAL.entity}, {LEGAL.address}, is responsible for the personal data
        described here. Contact us at{" "}
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
      </p>

      <h2>2. What we collect</h2>
      <ul>
        <li>
          <strong>Email address</strong> — needed to create your account and send
          what you asked for.
        </li>
        <li>
          <strong>WhatsApp number</strong> — optional. Only if you type it in,
          and only to send the alerts you asked for.
        </li>
        <li>
          <strong>Payment records</strong> — the fact that you paid, which plan,
          and when. The payment gateway handles the card itself; we never
          receive or store card numbers, CVV or UPI credentials.
        </li>
        <li>
          <strong>Basic technical data</strong> — the usual server logs any
          website keeps, used to keep the service working and to spot abuse.
        </li>
        <li>
          <strong>Usage data</strong> — pages viewed, visit times and approximate
          active session duration. When you are signed in, this activity is
          connected to your Market Tide email account.
        </li>
      </ul>
      <p>
        We do not ask for your PAN, demat account, broker login, portfolio or
        holdings, and you should never send them to us.
      </p>

      <h2>3. Why we use it</h2>
      <ul>
        <li>To give you the service you paid for.</li>
        <li>To tell you about changes to the service, or to your subscription.</li>
        <li>To take payment and issue refunds.</li>
        <li>To keep the service secure and prevent misuse.</li>
      </ul>
      <p>
        We will not send you unrelated marketing. If you joined the waitlist, we
        email you when it opens and then stop.
      </p>

      <h2>4. Who else sees it</h2>
      <p>We use a small number of service providers, each seeing only what they need:</p>
      <ul>
        <li><strong>Vercel</strong> — hosts the website and provides anonymized web analytics.</li>
        <li><strong>MongoDB</strong> — stores account, subscription, delivery-list and announcement data.</li>
        <li><strong>Resend</strong> — delivers verification and Daily Brief emails.</li>
        <li><strong>The payment gateway</strong> — handles your payment.</li>
        <li>
          <strong>AI providers</strong> — receive the text of public exchange
          filings so they can be summarised. They never receive your personal
          data.
        </li>
      </ul>
      <p className="callout">
        We do not sell your data, rent it, or share it with brokers, advisers or
        anyone else for their own marketing. Ever.
      </p>
      <p>
        We may disclose data if the law requires it, or to protect our rights or
        someone&rsquo;s safety.
      </p>

      <h2>5. How long we keep it</h2>
      <p>
        We keep account data while you are a subscriber and for up to one year
        afterwards, in case you come back or query a payment. Payment records are
        kept as long as Indian tax and accounting law requires. Waitlist entries
        are deleted if the waitlist is abandoned or when you ask.
      </p>

      <h2>6. Your choices</h2>
      <ul>
        <li>Ask what we hold about you.</li>
        <li>Ask us to correct it.</li>
        <li>Ask us to delete it — we will, unless we must keep it for tax records.</li>
        <li>Ask us to stop messaging you, without closing your account.</li>
      </ul>
      <p>
        Email <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> and we will act
        within 30 days. There is no charge.
      </p>

      <h2>7. Security</h2>
      <p>
        The site is served over HTTPS and credentials are held in encrypted
        storage. No system is perfectly secure, so we keep the amount of personal
        data we hold deliberately small — an email address, and sometimes a phone
        number.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use only what is needed to keep you signed in and to keep the site
        working. We use anonymized Vercel Web Analytics and our own first-party
        session analytics to understand page usage. We do not use advertising
        cookies or profile you across other websites, and detailed session data
        is automatically deleted after 90 days.
      </p>

      <h2>9. Children</h2>
      <p>
        The service is not intended for anyone under 18 and we do not knowingly
        collect their data.
      </p>

      <h2>10. Changes</h2>
      <p>
        If we change this policy materially we will tell subscribers before it
        takes effect. The date at the top shows the current version.
      </p>
    </div>
  );
}
