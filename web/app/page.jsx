"use client";

import { useEffect, useState } from "react";
import Nav from "./Nav";
import MkFooter from "./MkFooter";
import { PLANS } from "./site";

export default function Landing() {
  // Real numbers and real filings, pulled from the same store the dashboard
  // uses. Nothing on this page is a mock-up.
  const [live, setLive] = useState(null);

  useEffect(() => {
    fetch("/api/announcements?scope=important&limit=10")
      .then((r) => r.json())
      .then((d) => !d.error && setLive(d))
      .catch(() => {});
  }, []);

  const scanned = live?.meta?.scanned;
  // The same figure the dashboard shows under "worth reading". Two pages
  // quoting different numbers for the same thing reads as a broken product.
  const worthReading = live?.total;
  const days = live?.days?.length || 7;

  // A handful of genuinely interesting ones for the scrolling strip.
  const ticker = (live?.items || [])
    .filter((i) => i.summary && i.tag !== "Results")
    .slice(0, 14);

  const samples = (live?.items || []).filter((i) => i.summary).slice(0, 3);

  return (
    <>
      <Nav />

      <main className="mk">
        {/* ---------------- hero ---------------- */}
        <section className="mk-hero">
          <h1 className="mk-h1">
            Every filing read.{" "}
            <br />
            <span className="grad">Only the ones that matter, kept.</span>
          </h1>

          <p className="mk-sub">
            NSE and BSE publish thousands of company announcements a week. Almost
            all of it is paperwork. <strong>We read every single one</strong> and
            write a plain-English summary of the handful worth your time — with a
            link to the original PDF, always.
          </p>

          <div className="mk-ctas">
            <a className="btn-lg btn-grad" href="/dashboard">
              Open the dashboard <span aria-hidden="true">→</span>
            </a>
            <a className="btn-lg btn-ghost" href="/brief">
              Get the free daily brief
            </a>
          </div>
          <p className="mk-ctanote">
            Start with seven days of Premium free. The daily email newsletter always stays free.
          </p>

          {scanned ? (
            <div className="livestrip">
              <div className="livestat">
                <b>{Number(scanned).toLocaleString("en-IN")}</b>
                <span>filed on NSE &amp; BSE</span>
              </div>
              <div className="livestat hi">
                <b>{Number(worthReading || 0).toLocaleString("en-IN")}</b>
                <span>worth reading, all summarised</span>
              </div>
              <div className="livestat">
                <b>{days}</b>
                <span>days on the dashboard</span>
              </div>
              <div className="livestat">
                <b>{Object.keys(live?.tagCounts || {}).length}</b>
                <span>categories to filter</span>
              </div>
            </div>
          ) : null}
        </section>

        {/* ---------------- live ticker ---------------- */}
        {ticker.length > 4 && (
          <div className="ticker" aria-hidden="true">
            <div className="ticker-track">
              {[...ticker, ...ticker].map((t, i) => (
                <span className="tick" key={i}>
                  <span className="tk">{t.tag}</span>
                  <b>{t.company}</b>
                  <span>{(t.key_numbers || [])[0] || t.time}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ---------------- what you get ---------------- */}
        <section className="mk-sec">
          <div className="mk-sec-head">
            <p className="mk-kicker">What you actually get</p>
            <h2 className="mk-h2">Not headlines. The answer.</h2>
            <p className="mk-lead">
              These are real summaries produced in the last seven days. Nothing
              here is written for the pitch.
            </p>
          </div>

          {samples.length > 0 ? (
            samples.map((s) => (
              <article className="card" key={s.id}>
                <div className="card-top">
                  <div>
                    <div className="co">{s.company}</div>
                    <div className="meta">
                      {s.exchange} · {s.category} · {s.time}
                    </div>
                  </div>
                  <div className="badges">
                    <span className="b tag">{s.tag}</span>
                    {s.impact && (
                      <span
                        className={`b ${
                          s.impact === "Positive"
                            ? "pos"
                            : s.impact === "Negative"
                            ? "neg"
                            : "neu"
                        }`}
                      >
                        {s.impact}
                      </span>
                    )}
                  </div>
                </div>
                <p className="summary">{s.summary}</p>
                {(s.key_numbers || []).length > 0 && (
                  <div className="nums">
                    {s.key_numbers.map((n, i) => (
                      <span className="num" key={i}>
                        {n}
                      </span>
                    ))}
                  </div>
                )}
                {s.why_it_matters && <div className="why">{s.why_it_matters}</div>}
                <div className="card-links">
                  {s.pdf_url && (
                    <a href={s.pdf_url} target="_blank" rel="noopener noreferrer">
                      Open the original filing
                    </a>
                  )}
                  {!s.pdf_url && s.page_url && (
                    <a href={s.page_url} target="_blank" rel="noopener noreferrer">
                      View company on {s.exchange?.includes("BSE") ? "BSE" : "NSE"}
                    </a>
                  )}
                  <span className="verify">check it yourself</span>
                </div>
              </article>
            ))
          ) : (
            <div className="empty">Loading today&apos;s filings…</div>
          )}

          <div style={{ textAlign: "center", marginTop: 22 }}>
            <a className="btn-lg btn-ghost" href="/dashboard">
              See all of them <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        {/* ---------------- how ---------------- */}
        <section className="mk-sec">
          <div className="mk-sec-head">
            <p className="mk-kicker">How it works</p>
            <h2 className="mk-h2">Three steps, every evening</h2>
          </div>

          <div className="steps">
            <div className="step">
              <div className="step-n">1</div>
              <h3>We pull everything</h3>
              <p>
                Every announcement filed with both exchanges, every day —
                including weekends, when companies still file.
              </p>
            </div>
            <div className="step">
              <div className="step-n">2</div>
              <h3>We throw out the noise</h3>
              <p>
                Trading window notices, newspaper clippings, duplicate share
                certificates. Roughly nine in ten filings never reach you.
              </p>
            </div>
            <div className="step">
              <div className="step-n">3</div>
              <h3>We read the PDF</h3>
              <p>
                Including scanned ones. You get two or three sentences, the
                numbers that matter, and the original document to check.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------- why us ---------------- */}
        <section className="mk-sec">
          <div className="mk-sec-head">
            <p className="mk-kicker">Why it is different</p>
            <h2 className="mk-h2">Built to be checked, not trusted</h2>
          </div>

          <div className="bento">
            <div className="bx wide">
              <div className="bx-ico">
                <IconDoc />
              </div>
              <h3>Every card links to the PDF</h3>
              <p>
                We summarise with AI, and AI gets things wrong. So the original
                filing is one tap away on every single item. If our summary and
                the filing disagree, the filing wins.
              </p>
            </div>
            <div className="bx wide">
              <div className="bx-ico">
                <IconFilter />
              </div>
              <h3>Sorted by what it is</h3>
              <p>
                Buybacks, bonus issues, order wins, schemes of arrangement, QIPs,
                NCLT matters, rating changes — filter to the one thing you care
                about instead of scrolling.
              </p>
            </div>

            <div className="bx">
              <div className="bx-num">₹0</div>
              <h3>Free newsletter</h3>
              <p>The curated morning email remains free, with no card required.</p>
            </div>
            <div className="bx">
              <div className="bx-num">7</div>
              <h3>Days of history</h3>
              <p>Catch up on the whole week, not just what landed today.</p>
            </div>
            <div className="bx">
              <div className="bx-num">XLS</div>
              <h3>Export anything</h3>
              <p>
                Any filter, straight to Excel — with the PDF link in every row.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------- pricing ---------------- */}
        <section className="mk-sec home-pricing">
          <div className="mk-sec-head">
            <p className="mk-kicker">Plans for every reader</p>
            <h2 className="mk-h2">Start free. Go deeper when you need it.</h2>
            <p className="mk-lead">
              The newsletter is free forever. Premium brings the full research
              dashboard, filing history, filters, original PDFs and exports together.
            </p>
          </div>

          <div className="plan-grid plan-grid--home">
            <article className="plan-card">
              <div className="plan-card-head">
                <div><span className="plan-eyebrow">Newsletter only</span><h2>{PLANS.free.name}</h2></div>
                <div className="plan-price"><b>₹0</b><span>/ forever</span></div>
              </div>
              <p>A focused morning email with the filings worth knowing.</p>
              <ul className="plan-list">
                <li>Daily email newsletter</li>
                <li>Plain-English market highlights</li>
                <li>Unsubscribe any time</li>
              </ul>
              <a className="btn-lg btn-ghost plan-action" href="/brief#subscribe">Get the free newsletter</a>
            </article>

            <article className="plan-card plan-card--featured">
              <div className="plan-ribbon">7-day free trial</div>
              <div className="plan-card-head">
                <div><span className="plan-eyebrow">Complete access</span><h2>{PLANS.premium.name}</h2></div>
                <div className="plan-price"><b>₹{PLANS.premium.price}</b><span>/ {PLANS.premium.months} months</span></div>
              </div>
              <p>Everything needed to research important NSE and BSE filings efficiently.</p>
              <ul className="plan-list">
                <li>Full announcement dashboard</li>
                <li>Insider trading tracker</li>
                <li>Bulk and block deal tracker</li>
                <li>Summaries, key numbers and original PDFs</li>
                <li>Seven-day history, filters and Excel export</li>
                <li>Private investor community</li>
                <li>Free newsletter included</li>
              </ul>
              <a className="btn-lg btn-grad plan-action" href="/pricing">See everything included</a>
            </article>
          </div>
        </section>

        {/* ---------------- community teaser ---------------- */}
        <section className="mk-sec">
          <div className="finale">
            <h2>Start with seven days free.</h2>
            <p>
              Keep receiving the newsletter for free, or try the complete
              workspace for seven days. After the trial, Premium is ₹{PLANS.premium.price}
              for {PLANS.premium.months} months with no automatic renewal.
            </p>
            <div className="mk-ctas">
              <a className="btn-lg btn-grad" href="/pricing">
                Compare plans
              </a>
              <a className="btn-lg btn-ghost" href="/brief#subscribe">
                Get the free newsletter
              </a>
            </div>
          </div>
        </section>
      </main>

      <MkFooter />
    </>
  );
}

function IconDoc() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function IconFilter() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
