import { Inter, Instrument_Serif } from "next/font/google";
import AnalyticsGate from "./AnalyticsGate";
import EngagementTracker from "./EngagementTracker";
import { SiteAuthProvider } from "./SiteAuth";
import "./globals.css";
import "./theme.css";
import "./marketing.css";
import "./dash.css";
import "./auth.css";
import "./admin.css";
import "./pricing.css";
import "./payment.css";

// Inter for everything functional - it was built for screens and its tabular
// figures keep columns of rupee amounts from jittering. Instrument Serif only
// on the big marketing headlines, where a little editorial weight reads as
// considered rather than decorative.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});

export const metadata = {
  title: "Market Tide — the NSE & BSE filings that actually matter",
  description:
    "Thousands of corporate announcements are filed with NSE and BSE every week. "
    + "Market Tide reads every one and summarises the handful worth your time, in "
    + "plain English, with a link to the original filing.",
  openGraph: {
    title: "Market Tide — the NSE & BSE filings that actually matter",
    description:
      "We read every filing on NSE and BSE, and summarise the ones that matter. "
      + "Free daily newsletter, with a seven-day Premium trial.",
    type: "website",
  },
};

export const viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`}>
      <body>
        <SiteAuthProvider>
          <EngagementTracker />
          {children}
        </SiteAuthProvider>
        <AnalyticsGate />
      </body>
    </html>
  );
}
