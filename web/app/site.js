// Everything you'd want to change without touching a page.

export const SITE = {
  name: "Market Tide",

  phoneDisplay: "+91 82004 40146",
  phoneDigits: "918200440146",
  email: "market.tide27@gmail.com",

  // The free daily brief, already running.
  newsletterLink: "https://chat.whatsapp.com/B9cZ0FnmUFxKGUuXaqXG4H?s=cl&p=a&ilr=1",

  // Combined audience across the WhatsApp brief and the website list.
  // The website-form count alone is live at /api/waitlist; this is the wider
  // figure kept by hand, so update it as the group grows.
  readers: "500+",

};

// Keeping both plans here prevents
// the home, pricing and community pages from drifting apart.
export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    period: "forever",
    description: "The daily Market Tide newsletter in your inbox.",
  },
  premium: {
    id: "premium",
    name: "Premium",
    price: 299,
    months: 3,
    description: "The complete Market Tide research workflow.",
  },
};
