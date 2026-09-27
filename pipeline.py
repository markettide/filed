"""
The scrape-score-summarise pipeline, with no assumptions about where the
result goes.

run.py uses it to build the local HTML dashboard. publish.py stores the same
data in MongoDB so the website can serve it. Keeping this in one place
means the live site and your local dashboard can never drift apart.
"""

import concurrent.futures as cf
import datetime
import json
import os
import re
import threading

import providers
import numfmt
import rules
import sources
import summarize

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache.json")

_lock = threading.Lock()


def load_cache():
    try:
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_cache(cache):
    tmp = CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    os.replace(tmp, CACHE)


def spread_across_tags(items, n):
    """
    Choose which filings get an AI summary.

    Straight top-N by score hands every slot to whichever tag scores highest
    that day (usually M&A) and leaves results and order wins with none. So we
    go round the tags in turn, taking each tag's best remaining filing.
    """
    buckets = {}
    for a in items:
        buckets.setdefault(a["tag"], []).append(a)

    order = sorted(buckets, key=lambda t: -max(x["score"] for x in buckets[t]))
    chosen, i = [], 0
    while len(chosen) < n and any(buckets.values()):
        tag = order[i % len(order)]
        if buckets[tag]:
            chosen.append(buckets[tag].pop(0))
        i += 1
        if i > len(order) * (n + 5):
            break
    return chosen


def fetch_and_score(start, end, min_score, log=print):
    """Everything up to but not including the AI step."""
    log("Fetching BSE...")
    bse = sources.fetch_bse(start, end, log=log)
    log("Fetching NSE...")
    nse = sources.fetch_nse(start, end, log=log)

    raw = bse + nse

    # Which board each company is listed on - SME or main - so the two can be
    # shown separately. NSE said so in fetch_nse, from its own SME list; BSE
    # does not say at all, and gets it from the list of scrips published on
    # bsesme.com. See sources.tag_boards.
    sources.tag_boards(raw, log=log)

    # The RSS feeds are NOT read here, deliberately.
    #
    # They were, for a few hours on 3 September, as a safety net for anything
    # the APIs failed to return. It worked and it was a mistake. The feeds
    # carry the whole of both exchanges - debt instruments, mutual fund NAVs,
    # commercial paper redemptions, unlisted private companies - and they carry
    # no category at all, so every one of those 228 daily additions arrived as
    # an uncategorised row for the rules to guess at. Company names came
    # through as things like "VPIL-18%-RESET RATE-27-04-". It cluttered the
    # dashboard for no gain, and Ishan asked for it out.
    #
    # The two coverage faults it was meant to insure against are fixed at the
    # source instead, which is the better place: NSE is asked for all five of
    # its lists, and BSE retries a failed page rather than abandoning the day.
    #
    # The feeds are still read by tools/reconcile_feeds.py, which only reports.
    # Nothing it sees reaches the site.
    log(f"Total filings pulled: {len(raw)}")

    kept = []
    for a in raw:
        s, tag = rules.score(a["category"], a["headline"], a.get("critical"))
        a["score"], a["tag"] = s, tag
        if s >= min_score:
            kept.append(a)

    kept = sources.merge(kept)

    def sort_key(a):
        d = sources.parse_dt(a["dt"])
        return (-a["score"], -(d.timestamp() if d else 0))

    kept.sort(key=sort_key)

    for a in kept:
        d = sources.parse_dt(a["dt"])
        a["time"] = d.strftime("%d %b, %H:%M") if d else ""
        a["date"] = d.strftime("%Y-%m-%d") if d else ""

    log(f"Important after filtering: {len(kept)}")
    return raw, kept


# Tags a summary may not impose. Each says "we could not tell" rather than
# naming an event, and a filing that reached the page on the strength of its
# document should not be renamed to one of them by two sentences about it.
WEAK_FROM_SUMMARY = {"Meeting", "Routine", "Other", "Outcome", "Press Release",
                     "Corp Action", "Annual Report"}

# The categories a reader looks at first, and the ones a PDF most often puts a
# filing into by accident - an auditor's profile listing "Merger & Acquisition"
# among its services was enough, once. These have to be corroborated by the
# summary.
DEAL_TAGS = {"Acquisition", "Scheme Of Arrangement", "Open Offer"}

# One company buying another, said in a way a promoter's own dealing never is.
# A promoter buys "55,000 shares"; a company buys "100%", "the entire
# shareholding", "control of". See the guard in category_from_summary.
_COMPANY_BOUGHT_A_COMPANY = re.compile(
    r"acquir\w+[^.]{0,25}(100 ?%|entire (stake|shareholding|equity|"
    r"share capital)|majority (stake|shareholding)|control of)|"
    r"share purchase agreement|slump sale|"
    r"scheme of (arrangement|amalgamation|merger|demerger)", re.I)

_DEAL_EVIDENCE = re.compile(
    r"acquisi|acquir|merger|amalgamat|de-?merger|slump sale|divest|"
    r"\bstake\b|shareholding|takeover|share purchase|controlling interest|"
    r"sold its|sale of|joint venture|open offer|scheme of arrangement|"
    r"buy(s|ing)? out|hive[- ]off|transfer of[^.]{0,30}(business|undertaking)|"
    # Three real deals were being demoted for wording this did not know.
    # Capital India "is SELLING its RemitX forex assets to Kanji Forex";
    # International Gemological "will CONSOLIDATE CONTROL over IGI Botswana,
    # making it a wholly owned subsidiary"; NLC India "signed an addendum to
    # TRANSFER about 709 MW of renewable assets".
    r"sell(s|ing)?\b|consolidat\w+ control|control over|"
    r"transfer(ring)? (of )?[^.]{0,30}(assets|megawatt|\bmw\b|portfolio)",
    re.I)


# A record date is only a dividend if it is a record date FOR the dividend.
#
# All 39 of these read the same way - "has scheduled its 47th Annual General
# Meeting for September 29 ... has set September 18 as the record date to
# determine shareholder eligibility for the proposed dividend" - and every
# one was published as a Meeting, because the meeting is named first.
#
# The window is wide (120 characters) because the sentence that links them is
# long: "the record date to determine shareholder eligibility for the final
# dividend" is 71 characters between the two words.
_RECORD_DATE_FOR = re.compile(
    r"(record date|book closure|cut-?off date|"
    r"(register|books?) of (members|transfer)[^.]{0,40}clos)"
    r"[^.]{0,120}(dividend|bonus|split|interim payout)|"
    r"(dividend|bonus|split)[^.]{0,120}"
    r"(record date|book closure|cut-?off date)", re.I)


def category_from_summary(category, headline, blob, current=None):
    """The category a filing's own words argue for, or None to keep what it has.

    Pulled out of summarise() so the tests exercise the real decision instead
    of a copy of it. The copy is how this went wrong: the tests asserted on
    rules.score_text() alone while production combined it with the headline,
    so a change that was right in one place and wrong in the other passed.
    """
    # A score threshold used to sit here, refusing anything under 55. It was
    # aimed at one real problem - a dividend whose summary mentions the AGM
    # that will approve it was being relabelled "Meeting" - but it also
    # refused every accurate label that happens to score low. Change In
    # Management is 51, so Hexaware's new chief executive stayed under
    # Acquisition through four passes while the rules named it correctly
    # every time. The tags to refuse are the vague ones, not the low-scoring
    # ones. Nothing is lost by relabelling: the SCORE is never changed here,
    # so a filing keeps its place on the page and only gets a truer name.
    # Normalise the text ONCE, here, before any rule reads it.
    #
    # score() and score_text() do this internally, but the dozen
    # predicates below - meeting_only, meeting_is_the_subject,
    # debt_servicing, board_meeting_notice - are called with the raw
    # blob, and every one of them is windowed with [^.]. A full stop that
    # is not the end of a sentence blinds all of them at once:
    #
    #   "set a record date for a Rs 0.60 dividend, and scheduled the AGM"
    #        record date[^.]{0,60}(dividend) cannot see past "Rs 0",
    #        so no money event was found, so the filing was a Meeting
    #
    # That is Aristo Bio-Tech, and it is the mistake that turned sixty
    # real dividends into meetings in August. Normalising in one place is
    # the difference between fixing this and fixing it again next month.
    blob = rules.soften_stops(blob)

    _, from_summary = rules.score_text(blob, floor=0)

    # A letter of intent can describe an acquisition, not a customer order.
    # Keep the original acquisition verdict unless the summary also contains
    # real evidence of commercial work, supply, a contract or a tender.
    if (from_summary == "Order"
            and re.search(r"letter of intent|\bloi\b", blob, re.I)
            and re.search(r"acqui|purchas|\bbuy\b|subscrib", blob, re.I)
            and not re.search(r"customer|client|supply|services?|work order|"
                              r"contract (?:won|awarded|received|secured)|"
                              r"project|tender", blob, re.I)):
        from_summary = None

    # Two ways a filing is a meeting notice, and neither may overrule a real
    # event.
    #
    # The first is that the HEADLINE says so - "corrigendum to its 18th Annual
    # General Meeting notice". Then the notice is the subject of the filing,
    # and the resolutions it recites are things the meeting will be ASKED to
    # approve rather than things that have happened. That is how eight AGM
    # notices came to be filed under Pref.
    #
    # The second is that the summary says so AND names no other event at all.
    # Notice and nothing else.
    #
    # What is deliberately NOT enough is the summary merely mentioning a
    # meeting. The first version of this did exactly that, and renamed four
    # dividends "Meeting" - Sunteck Realty's record date, Foseco's approved
    # final dividend - because the summary mentioned the AGM. There the
    # meeting is context and the dividend is the news.
    # "Names no other event" has to mean no SUBSTANTIVE event, not no tag at
    # all. The tags on the refuse list are the ones that say "we could not
    # tell" - Annual Report, Corp Action, Outcome, Press Release - and reading
    # one of those as an event was enough to block the notice test:
    #
    #   Tega Industries    summary: "50th AGM is scheduled for September 24"
    #                      score_text: (28, Annual Report)  -> not empty
    #                      so the notice branch was skipped, Annual Report was
    #                      then refused as too weak, and the filing kept the
    #                      tag its PDF had given it. Dividend.
    #
    # Seven filings under Dividend on 3 September were meeting notices that
    # got there this way, along with several under Pref and Warrants.
    substantive = from_summary and from_summary not in WEAK_FROM_SUMMARY

    # Who moved the shares is not something a summary can overturn.
    #
    # Promoter Buy/Sell and Inter-se Transfer are set from the stake-disclosure
    # category, which is the authoritative record of WHO - the form is filed
    # under SAST precisely to say so. The summary of one reads "Innovative
    # Money Matters Pvt Ltd acquired 55,000 shares of Avonmore Capital",
    # never using the word promoter at all, and scoring that gives Acquisition
    # at 65. Twelve promoter dealings were being relabelled acquisitions on
    # exactly that: a sentence that does not contradict the category, it just
    # does not repeat it.
    #
    # But only when the tag came from the FORM. Filed under SAST or
    # Regulation 29, the disclosure is authoritative about who moved the
    # shares. Arrived from a regex in some attachment, it is not - every SAST
    # form prints "promoter and promoter group" in its table headings whether
    # or not the acquirer is a promoter, and that is enough for triage to
    # promote. Without this condition the guard protected the wrong tag:
    # Systematic Industries, acquiring 100% of Wire Brigade Industries and
    # filed under "Corp. Action / Record Date", was held at Promoter Buy/Sell
    # while its summary said Acquisition, and so was Avanti Feeds
    # incorporating a subsidiary in Ecuador.
    # ...unless the summary says the COMPANY bought a company. 7NR Retail
    # "acquired 100% of Cultureantique Jewellery Private Limited", filed on a
    # takeover form, was held at Promoter Buy/Sell by this guard and went out
    # on the insider page as a promoter trade.
    #
    # Narrow on purpose. rules.part_of_a_bigger_deal would do it, and cannot
    # be used here: every SAST headline carries the words "Substantial
    # Acquisition of Shares & Takeovers", so it would unlock the guard for
    # the whole category it exists to protect.
    if (current in ("Promoter Buy/Sell", "Inter-se Transfer")
            and rules.stake_category(category or "")
            and from_summary in ("Acquisition", "Stake Change")
            and not _COMPANY_BOUGHT_A_COMPANY.search(blob)):
        from_summary = None

    # A notice that the BOARD is going to meet is the same mistake one meeting
    # down: it names the thing the board will consider, so it was filed as that
    # thing. Manba Finance's "will hold a board meeting to consider increasing
    # its authorised share capital" came out as Pref; NHC Foods' "board will
    # meet to discuss a possible fund raise" as Warrants. Neither board had met.
    #
    # Checked before the general meeting test and before everything else,
    # because a board notice mentioning the AGM would otherwise become a
    # Meeting - which is nearer, and still not what the filing is.
    # A deal has to be visible in the summary.
    #
    # Acquisition, Scheme Of Arrangement and Open Offer are the categories a
    # reader looks at first, and the ones that arrive from the PDF most often -
    # an attachment need only mention "merger & acquisition" once. When the
    # summary of the same filing contains no deal language at all, there was no
    # deal: Bodhtree's 2035 vision document, Shadowfax's channel partner
    # programme, and Mobavenue winning four Gold awards at an industry event
    # were all sitting under Acquisition.
    #
    # Whatever the summary DID find is used instead, and "Other" when it found
    # nothing - which is honest, and keeps the filing on the site under All
    # rather than on the front page as a deal that never happened.
    # Both halves have to agree: deal language somewhere, AND language
    # for THIS deal. One shared regex for all three tags was not enough,
    # because "sale of" satisfies it and a sale is not a scheme. Two
    # divestments and a property sale were sitting under Scheme Of
    # Arrangement on 8 September on exactly that - Elgi Equipments,
    # Gujarat Apollo and Sanginita - and a scheme outranks an
    # acquisition (69 to 65), so nothing else could dislodge them.
    # The loose evidence list, NOT rules.topic_matches.
    #
    # Tightening this to the topic pattern was tried on 12 September and it
    # demoted real deals wholesale: Coforge divesting AdvantageGo, Dilip
    # Buildcon selling a 51% stake, Medplus buying out a minority, Maithan
    # Alloys buying shares. The topic pattern wants a particular verb next to a
    # particular object, and a summary written by a person says "selling its
    # 51% stake" or "buying the remaining 0.01% stake" instead.
    #
    # So the loose list stays. It lets a few through - a joint venture company
    # changing its NAME reads as evidence of a joint venture - and that is the
    # cheaper mistake. This guard exists to catch a filing with nothing to do
    # with its category, not to adjudicate the ones that nearly belong.
    if (current in DEAL_TAGS and blob
            and not (_DEAL_EVIDENCE.search(blob)
                     and rules.tag_supported(current, blob))):
        return from_summary or "Other"

    # Paying a debt is not raising one, and this has to be an explicit return.
    #
    # score_text already answers "Routine" for these, correctly - but Routine
    # is on the refuse list below, so the answer was thrown away and the wrong
    # tag survived. All ten of the debt-servicing filings under Fund Raising on
    # 8 September stayed there for exactly that reason.
    #
    # The same shape as the AGM notices: a correct low-confidence answer
    # refused for being low-confidence, leaving a confident wrong one in place.
    # A refuse list needs an exception for every rule that deliberately demotes.
    if rules.debt_servicing(blob):
        return "Routine"

    # And an exchange clearing shares to trade is not the issue that created
    # them. Same reason this needs an explicit return: "Listing Approval" is
    # not on the refuse list, but the tag it must beat scores higher.
    if rules.listing_approval(blob):
        return "Listing Approval"

    # When the exchange says the filing IS the financial results, it is.
    #
    # A results summary mentions whatever else the quarter contained, and
    # the mention outscores the results: Maruti Interior Products' Q1
    # filing "also noted the completion of a Rs 45.30 crore Rights
    # Issue", and Rights Issue scores 72 against Results' 64, so a
    # completed issue from some earlier month became the news.
    if (re.search(r"^result|financial result|(quarterly|annual) result",
                  category or "", re.I)
            and re.search(r"result|quarter|profit|revenue|loss|ebitda",
                          blob, re.I)):
        return "Results"

    # Going to a conference to talk about results already published is the
    # conference, not the results.
    #
    # Motilal Oswal "will participate in upcoming investor conferences in
    # September 2026. The company will discuss previously released financial
    # results for the quarter ended June 30" scores 64 as Results against
    # Investor Meet's 55, so the subject of the trip became the filing.
    if (re.search(r"(will |to )?(participat\w+|attend\w*|present\w*)"
                  r"[^.]{0,60}(investor|analyst|institutional)"
                  r"[^.]{0,30}(conference|meet|call|roadshow|summit)",
                  blob, re.I)
            and re.search(r"previously|already|earlier (released|published|"
                          r"announced)|released financial", blob, re.I)):
        return "Investor Meet"

    if rules.board_meeting_notice(blob):
        return "Board Meeting"

    # When the general meeting is what the filing is ABOUT - a book closure
    # naming it as the purpose, or a summary that opens by scheduling one - it
    # wins over a substantive read. These filings say "for the AGM and
    # dividend" in one breath, so the dividend is always there to be scored,
    # and five of them were sitting under Dividend on 4 September.
    # A dividend record date is a dividend, even when the summary opens by
    # scheduling the meeting.
    #
    # Aristo Bio-Tech filed under "Record Date", with a headline that says
    # "Record date for the...", and a summary reading "has scheduled its 21st
    # Annual General Meeting ... also declared a final dividend of Rs 0.60
    # per share and set September 23 as the record date". The AGM is named
    # first, so the test below - which asks which purpose is named first -
    # made it a Meeting.
    #
    # Two sources say otherwise and both are more reliable than word order:
    # the exchange filed it as a record date, and a dividend was actually
    # DECLARED. meeting_only is what separates this from the AGM notice that
    # merely reminds shareholders to claim old dividends - there, nothing was
    # declared, and it stays a Meeting.
    # Stated rather than inferred: the record date has to be FOR the payout.
    # A record date fixed only to decide who may vote at the meeting is the
    # meeting, and stays one.
    if (re.search(r"record date|book closure", category or "", re.I)
            and from_summary in ("Dividend", "Bonus", "Split", "Corp Action")
            and _RECORD_DATE_FOR.search(blob)
            and not rules.meeting_only(category or "", headline or "", blob)):
        return from_summary

    if rules.meeting_is_the_subject(blob):
        return "Meeting"

    # The backstop. An AGM never belongs in another category, so if this is a
    # notice of a general meeting and nothing was actually approved, declared,
    # allotted, received or paid, it is a Meeting - whatever money words the
    # text happens to contain. Filatex India's letter carrying "web links to
    # the 36th AGM notice and a reminder to claim any unclaimed dividends" was
    # published as a Dividend on those two words.
    if rules.meeting_only(category or "", headline or "", blob):
        return "Meeting"

    if rules.meeting_notice(category or "", headline or "", ""):
        from_summary = "Meeting"
    elif not substantive and rules.meeting_notice("", "", blob):
        from_summary = "Meeting"
    elif not substantive:
        from_summary = None

    # The same rule, for every other category that claims a specific event.
    #
    # The deal check above was written for three categories because that is
    # where a reader happened to notice it. The fault is not specific to
    # deals - triage reads every attachment and promotes on a regex hit, so
    # any passing word in a forty-page document can name the filing. On
    # 8 September:
    #
    #   Maral Overseas       a report on the re-lodgement of physical share
    #                        transfer requests, published as a Clinical Trial
    #   Venus Remedies (x2)  a special window for re-lodging physical shares,
    #                        also Clinical Trial
    #   Superior Industrial  a secretarial audit report, published as a Buyback
    #   Elgi Equipments      a subsidiary selling its stake, as a Scheme
    #
    # Each one scored 18/Other on its headline and NOTHING on its summary.
    # The summary is written from the same document by a model that read all
    # of it, so if the document were really about a clinical trial the summary
    # would say so. It says nothing of the kind, which makes the match
    # incidental.
    #
    # Narrow on purpose - it only fires when the tag could ONLY have come from
    # the document: not from the headline, and not from the summary. A tag the
    # headline states outright is left alone even when the summary is silent,
    # because then two sources are not disagreeing, one is just quieter.
    if (current and blob
            and current not in DEAL_TAGS
            and current != from_summary
            and rules.score(category or "", headline or "")[1] != current
            # The exchange's own category is a source in its own right, and
            # a headline can drown it out: Zinema Media's "Approval for
            # Preferential Issue pursuant to NCLT order" scores 64/Legal-Reg
            # on the headline while the category says, plainly, "Company
            # Update / Preferential Issue". Asking the category on its own
            # is what keeps a filing the exchange has already classified
            # from being demoted for a summary that words it differently.
            and rules.score(category or "", "")[1] != current
            and not rules.tag_supported(current, blob)):
        return from_summary or "Other"

    # retag() still has the last word. It exists for the cases where the words
    # are right but the meaning is inverted - a tax demand and an order win are
    # both "receipt of order".
    return rules.retag(blob) or from_summary


def summarise(kept, provider_list, max_summaries, workers=4, log=print):
    """Read PDFs and summarise a spread of the most important filings."""
    # Everything worth reading gets a summary. There is no second tier - if a
    # filing is good enough to show, it is good enough to explain. The spread
    # only decides the ORDER when a cap is in force; with no cap it is the
    # whole list, best first.
    if not max_summaries or max_summaries >= len(kept):
        todo = sorted(kept, key=lambda a: -a.get("score", 0))
    else:
        todo = spread_across_tags(kept, max_summaries)
    if not provider_list or not todo:
        return []

    cache = load_cache()
    done = [0]
    fail_reason = [""]        # the last error, for the log line at the end

    def work(a):
        if a["id"] in cache:
            a.update(cache[a["id"]])
            with _lock:
                done[0] += 1
                log(f"  [{done[0]}/{len(todo)}] cached  {a['company'][:42]}")
            return

        res = summarize.summarize(a, provider_list)
        if "error" in res:
            a["summary"] = ""
            a["summary_error"] = str(res["error"])[:160]
            a["impact"] = ""
            a["key_numbers"] = []
            a["why_it_matters"] = ""
            note = "FAILED"
            fail_reason[0] = a["summary_error"]
        else:
            a["summary"] = res.get("summary", "")
            a["impact"] = res.get("impact", "")
            a["key_numbers"] = res.get("key_numbers", [])
            a["why_it_matters"] = res.get("why_it_matters", "")
            with _lock:
                cache[a["id"]] = {k: a[k] for k in
                                  ("summary", "impact", "key_numbers",
                                   "why_it_matters", "source_used")}
            note = a.get("source_used", "")
        with _lock:
            done[0] += 1
            log(f"  [{done[0]}/{len(todo)}] {note:<16} {a['company'][:42]}")

    log(f"Reading {len(todo)} PDFs and summarising...")
    with cf.ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(work, todo))

    # A rate limit or a timeout is not a verdict on the filing, so anything
    # still without a summary goes round again. Two extra passes is enough to
    # clear a transient failure without grinding on a PDF that cannot be read.
    #
    # But only while there is something left to ask. Once every model has hit
    # its daily cap, a retry cannot succeed, and three passes over a few
    # hundred filings is how one run spent 2h17m on a single day and held the
    # schedule for five and a half hours. The run carries on either way and
    # publishes what it has - a missing summary is not a reason to fail.
    for attempt in (1, 2):
        missing = [a for a in todo if not a.get("summary")]
        if not missing:
            break
        left = providers.alive(provider_list)
        if not left:
            log(f"Retry {attempt}: skipped - every model has used up its quota "
                f"for today ({len(missing)} filings left unsummarised)")
            break
        log(f"Retry {attempt}: {len(missing)} filings still need a summary "
            f"({len(left)} models still available)")
        done[0] = 0
        with cf.ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            list(ex.map(work, missing))

    still = [a for a in todo if not a.get("summary")]
    if still:
        log(f"  {len(still)} could not be summarised. Last reason: "
            f"{fail_reason[0] or 'unknown'}")
        gone = providers.dead_models()
        if gone:
            log(f"  models out of quota for today: {', '.join(gone)}")
    save_cache(cache)

    # ---------------------------------------------------------------------
    # The category comes from the SUMMARY, not the document.
    #
    # A filing's PDF is not one statement. It is a document containing many
    # sentences about many things, and scoring 4,000 characters of it means
    # any topic word anywhere decides the label. Every wrong category on the
    # site came from a phrase that belonged to a different sentence: an
    # auditor's list of services ("Merger & Acquisition"), a blank SAST form's
    # own options ("rights issue / preferential allotment"), the other side's
    # name in a lawsuit ("Joint Venture of OHL"), a trading-window paragraph,
    # a website breadcrumb. There is no end to that supply, and patching them
    # one at a time never finishes.
    #
    # The summary is two sentences saying what the filing IS, with none of
    # that in it. Measured over the 1,199 filings live on 1 September: 146
    # carried a category their own summary contradicted; scoring the summary
    # instead leaves 5.
    #
    # The score is NOT changed. Importance was already decided, by the rules
    # and the document, and a filing that earned its place keeps it - this
    # only settles what to call it. Filings without a summary keep the tag the
    # rules gave them, which is the only thing available for them anyway.
    # ---------------------------------------------------------------------
    fixed = 0
    for a in todo:
        # The summary and the figures, but NOT why_it_matters.
        #
        # The summary is an account of what the filing says. why_it_matters is
        # commentary about it, and commentary is where the negations live:
        # Mukat Pipes' AGM book-closure carries "a routine administrative
        # update regarding the upcoming AGM and voting eligibility, with no
        # dividend declared for the year". Scoring that matches the word
        # dividend, at 60, and the filing was published as one - on a sentence
        # whose entire point is that there was no dividend.
        #
        # Nothing is lost. Anything why_it_matters names, the summary named
        # first; that is what it is commentary on.
        blob = " ".join([
            a.get("summary") or "",
            " ".join(a.get("key_numbers") or []),
        ]).strip()
        if not blob:
            continue

        # Two things the summary must not be allowed to decide.
        #
        # The three meeting kinds are settled from the category and headline,
        # and they are already right - Investor Meet is 1% wrong, Concall 0%.
        # Their summaries describe what was DISCUSSED on the call, which is
        # usually the quarter's results, so scoring them moved 17 concalls and
        # investor meets into Results.
        if a.get("tag") in rules._MEETING_TAGS:
            continue

        better = category_from_summary(
            a.get("category", ""), a.get("headline", ""), blob, a.get("tag"))

        if better and better != a["tag"]:
            log(f"  relabelled: {a['company'][:36]:<38} "
                f"{a['tag']} -> {better}")
            a["tag"] = better
            fixed += 1

            # A relabel may also PROMOTE, which it could not before.
            #
            # The score used to be left alone here on purpose, so a filing kept
            # its place on the page and only got a truer name. That was right
            # while everything being relabelled was already above the line.
            # It is wrong for a press release: a company files one under the
            # category "Press Release" with the headline "Please refer attached
            # file", which scores 44, and 44 is below the line. Renaming it
            # "Order" and leaving it at 44 puts a Rs 100 crore order win on a
            # page nobody reads. Balaji Telefilms filed on both exchanges on
            # 4 September and appeared on neither.
            #
            # Only upwards, and only to what the new tag is worth. A summary
            # can rescue a filing the headline buried; it can never bury one.
            worth_now = rules.SCORE_FOR_TAG.get(better, 0)
            if worth_now > a.get("score", 0):
                a["score"] = worth_now
    if fixed:
        log(f"  ({fixed} categories taken from the summary rather than the document)")

    return todo


FIELDS = ("id", "exchange", "company", "ticker", "category", "headline", "time",
          "date", "score", "tag", "pdf_url", "page_url", "summary", "impact",
          "key_numbers", "why_it_matters", "mcap", "also_filed", "also_tags",
          # SME or Main. Without it here the board is worked out on every run
          # and then dropped on the way to the site, which is exactly what
          # happened to NSE's SME list for the first week it was fetched.
          "board")


def to_rows(kept):
    """Trim to the fields the dashboard and the Excel export actually use."""
    # Figures get tidied on the way out rather than at summarising time, so a
    # summary that has been sitting in the cache since before this existed is
    # corrected too, without paying to generate it again.
    return [numfmt.fix_all({k: a.get(k, "") for k in FIELDS}) for a in kept]


def run(days, min_score, max_summaries, provider_list, workers=4, log=print):
    """Full pipeline. Returns (rows, stats)."""
    ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    today = datetime.datetime.now(ist).date()
    start = today - datetime.timedelta(days=max(0, days))

    raw, kept = fetch_and_score(start, today, min_score, log=log)
    summarise(kept, provider_list, max_summaries, workers=workers, log=log)

    stats = {
        "scanned": len(raw),
        "important": len(kept),
        "summarised": sum(1 for a in kept if a.get("summary")),
        "from": start.isoformat(),
        "to": today.isoformat(),
    }
    return to_rows(kept), stats
