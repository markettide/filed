import { LEGAL } from "../../lib/legal";

export const metadata = { title: "Refund & Cancellation Policy — Market Tide" };

export default function Refund() {
  return (
    <div className="wrap legal">
      <a className="back" href="/">← Market Tide</a>
      <h1>Refund &amp; Cancellation Policy</h1>
      <p className="updated">Last updated {LEGAL.updated}</p>

      <p className="callout">
        <strong>The short version.</strong> You can leave whenever you like — no
        lock-in, no notice. The seven-day trial is free and needs no card. The
        ₹299 three-month Premium fee is{" "}
        <strong>non-refundable</strong> once you have joined. We only refund if we
        charged you twice, your payment succeeded but access was not provided,
        or we stop running the service during the term you paid for.
      </p>

      <h2>1. What you are buying</h2>
      <p>
        Premium is a three-month plan, paid once up front. It gives you access
        to the full dashboard and Premium tools for three months after Cashfree
        verifies the payment.
      </p>
      <p>
        The daily email newsletter is free and is not part of this payment.
        Ending or allowing Premium to expire does not take the newsletter away.
      </p>

      <h2>2. Cancelling</h2>
      <p>
        Email <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> or message{" "}
        {LEGAL.phoneDisplay} on WhatsApp and we will remove you from the
        community. There is no fee and no notice period.
      </p>
      <p>
        Memberships do not auto-renew. Nothing is charged again unless you choose
        to renew, so cancelling simply means we will not ask you to.
      </p>

      <h2>3. The fee is non-refundable</h2>
      <p>
        <strong>
          Once paid access has been activated, the three-month fee is not refundable — in part or in
          full — for any reason, including if you stop using it or change your
          mind.
        </strong>{" "}
        Access continues to the end of the three months you paid for, whether you
        use it or not.
      </p>
      <p>
        We say this plainly because we would rather you decide carefully than feel
        misled later. Every account gets one free seven-day Premium trial before
        payment is offered, with no card required and no automatic charge.
      </p>

      <h2>4. The two exceptions</h2>
      <p>We will refund, without you having to ask twice:</p>
      <ul>
        <li>
          <strong>You were charged more than once</strong> for the same
          membership. We refund the duplicate in full.
        </li>
        <li>
          <strong>We stop running the service</strong> during a term you have paid
          for. We refund the unused portion of the term.
        </li>
      </ul>
      <p>
        These are not favours; they are the situations where we would be keeping
        money for something you did not receive.
      </p>

      <h2>5. If something has gone wrong</h2>
      <p>
        A refund is not the only remedy, and often not the best one. If the
        service is not working, a summary is wrong, or you cannot access the
        community, tell us at{" "}
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> and we will fix it.
        We read every message.
      </p>

      <h2>6. Removal from the community</h2>
      <p>
        We remove members who post buy-sell tips, promotional material, or
        anything that makes the room worse for everyone else. That is what people
        are paying for. Removal on those grounds does not carry a refund.
      </p>

      <h2>7. How refunds are paid, where they apply</h2>
      <p>
        Approved refunds go back to the original payment method. We approve or
        query within <strong>2 working days</strong>, and the money typically
        reaches you within <strong>5 to 7 working days</strong> depending on your
        bank. We do not charge a processing fee.
      </p>

      <h2>8. Contact</h2>
      <p>
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> · WhatsApp{" "}
        {LEGAL.phoneDisplay} · <a href="/contact">contact page</a>
      </p>
    </div>
  );
}
