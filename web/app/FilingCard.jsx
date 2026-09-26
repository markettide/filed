"use client";

import { mcapLabel, mcapTier } from "./fmt";

/**
 * One filing, as the reader sees it.
 *
 * Lifted out of the dashboard so the watchlist can show the same thing. It
 * was already ninety lines of markup in a six-hundred-line component, and the
 * dashboard's own comment about the two board pages says why this is not
 * copied instead: "copying 580 lines to change one query parameter is how two
 * pages drift apart until only one of them gets the next fix."
 *
 * A filing card is that same argument. The Telegram message in
 * lib/telegram.js is deliberately built from the same three things - the
 * summary, the numbers, the PDF - for the same reason.
 */

const impactClass = (i) =>
  i === "Positive" ? "pos" : i === "Negative" ? "neg" : "neu";

export default function FilingCard({ it }) {
  const nums = Array.isArray(it.key_numbers) ? it.key_numbers : [];

  return (
    <article className={`card imp-${it.impact || "Neutral"}`}>
      <div className="card-head">
        <div className="co-line">
          <span className="co">{it.company}</span>
          {mcapLabel(it.mcap) && (
            <span className={`mcap ${mcapTier(it.mcap)}`}>
              {mcapLabel(it.mcap)}
            </span>
          )}
        </div>
        <div className="meta-line">
          <span className="b tag">{it.tag}</span>
          {it.impact && (
            <span className={`b ${impactClass(it.impact)}`}>{it.impact}</span>
          )}
          <span className="meta">{it.time}</span>
          <span className="meta hide-sm">· {it.exchange}</span>
        </div>
      </div>

      {it.summary ? (
        <p className="summary">{it.summary}</p>
      ) : (
        <>
          <div className="head">{it.headline}</div>
          <span className="no-summary">Routine filing — not summarised</span>
        </>
      )}

      {nums.length > 0 && (
        <div className="nums">
          {nums.map((n, i) => (
            <span className="num" key={i}>{n}</span>
          ))}
        </div>
      )}

      {it.why_it_matters && <div className="why">{it.why_it_matters}</div>}

      {/* Two shapes here. Filed under DIFFERENT headings, so the other
          headings are worth naming; or filed more than once under the SAME
          heading, where there is no other heading to name and the count is
          the whole story. The second case used to render "Also filed as"
          followed by nothing. */}
      {it.also_filed > 0 && (
        <div className="also">
          {(it.also_tags || []).length > 0 ? (
            <>
              <span>Also filed as</span>
              {it.also_tags.map((t) => (
                <span className="also-tag" key={t}>{t}</span>
              ))}
            </>
          ) : (
            <span>Filed {it.also_filed + 1} times</span>
          )}
        </div>
      )}

      <div className="card-links">
        {it.pdf_url && (
          <a href={it.pdf_url} target="_blank" rel="noopener noreferrer">
            Open filing
          </a>
        )}
        {!it.pdf_url && it.page_url && (
          <a href={it.page_url} target="_blank" rel="noopener noreferrer">
            View company on {it.exchange?.includes("BSE") ? "BSE" : "NSE"}
          </a>
        )}
        {!it.pdf_url && !it.page_url && (
          <span className="verify">Filing link unavailable</span>
        )}
      </div>
    </article>
  );
}
