import Nav from "../Nav";
import MkFooter from "../MkFooter";
import { PLANS } from "../site";

export const metadata = {
  title: "Pricing — Market Tide",
  description: "Choose the free Market Tide newsletter or Premium access to the complete filings dashboard.",
};

const premiumFeatures = [
  "Everything in the Free plan",
  "Full NSE and BSE announcement dashboard",
  "Insider trading tracker",
  "Bulk and block deal tracker",
  "Plain-English summaries and key numbers",
  "Important-filing filters and categories",
  "Seven days of searchable history",
  "Original exchange PDF links on every item",
  "Excel export for your filtered results",
  "Private Market Tide investor community",
];

export default function PricingPage() {
  return (
    <>
      <Nav />
      <main className="mk plans-page">
        <section className="plans-hero">
          <p className="mk-kicker">Simple pricing</p>
          <h1 className="mk-h1">Read less noise.{" "}<br /><span className="grad">Know what matters.</span></h1>
          <p className="mk-sub">
            Keep the morning newsletter free, or unlock the complete Market Tide
            workflow with one straightforward three-month plan.
          </p>
          <span className="launch-pill">Premium launching soon</span>
        </section>

        <section className="plan-grid" aria-label="Market Tide plans">
          <article className="plan-card">
            <div className="plan-card-head">
              <div>
                <span className="plan-eyebrow">Newsletter</span>
                <h2>{PLANS.free.name}</h2>
              </div>
              <div className="plan-price"><b>₹0</b><span>/ forever</span></div>
            </div>
            <p>{PLANS.free.description}</p>
            <ul className="plan-list">
              <li>Curated morning newsletter</li>
              <li>The filings that matter, in plain English</li>
              <li>Delivered directly to your inbox</li>
              <li>Unsubscribe any time</li>
            </ul>
            <a className="btn-lg btn-ghost plan-action" href="/brief#subscribe">
              Get the free newsletter
            </a>
            <p className="plan-fine">Dashboard, history, filters and exports are not included.</p>
          </article>

          <article className="plan-card plan-card--featured">
            <div className="plan-ribbon">Best for active investors</div>
            <div className="plan-card-head">
              <div>
                <span className="plan-eyebrow">Complete access</span>
                <h2>{PLANS.premium.name}</h2>
              </div>
              <div className="plan-price"><b>₹{PLANS.premium.price}</b><span>/ {PLANS.premium.months} months</span></div>
            </div>
            <p>{PLANS.premium.description}</p>
            <ul className="plan-list">
              {premiumFeatures.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <span className="btn-lg btn-grad plan-action plan-soon" aria-disabled="true">
              Coming soon
            </span>
            <p className="plan-fine">No payment is taken today. We will announce billing before Premium launches.</p>
          </article>
        </section>

        <section className="plan-compare">
          <div className="mk-sec-head">
            <p className="mk-kicker">What changes</p>
            <h2 className="mk-h2">Newsletter or the complete workspace</h2>
          </div>
          <div className="compare-table" role="table" aria-label="Plan comparison">
            <div className="compare-row compare-head" role="row">
              <span>Feature</span><b>Free</b><b>Premium</b>
            </div>
            {[
              ["Daily email newsletter", "Yes", "Yes"],
              ["Announcement dashboard", "—", "Yes"],
              ["Insider trading tracker", "—", "Yes"],
              ["Bulk and block deal tracker", "—", "Yes"],
              ["Important filing summaries", "—", "Yes"],
              ["Filters and categories", "—", "Yes"],
              ["Seven-day history", "—", "Yes"],
              ["Original PDF links", "—", "Yes"],
              ["Excel export", "—", "Yes"],
              ["Private investor community", "—", "Yes"],
            ].map(([feature, free, premium]) => (
              <div className="compare-row" role="row" key={feature}>
                <span>{feature}</span><span>{free}</span><strong>{premium}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="plans-faq">
          <div className="mk-sec-head">
            <p className="mk-kicker">Good to know</p>
            <h2 className="mk-h2">Before Premium opens</h2>
          </div>
          <div className="faq-grid">
            <article><h3>Can I stay on Free?</h3><p>Yes. The email newsletter remains the complete Free plan, with no card required.</p></article>
            <article><h3>When will I be charged?</h3><p>Not yet. Payment is not connected. We will show the price and terms before asking you to subscribe.</p></article>
            <article><h3>What happens to current access?</h3><p>Premium tools remain available during the launch preview. We will notify readers before access rules change.</p></article>
            <article><h3>Is this investment advice?</h3><p>No. Market Tide summarises public filings. Always read the original filing before acting.</p></article>
          </div>
        </section>
      </main>
      <MkFooter />
    </>
  );
}
