/**
 * The default taxonomy. Everything here is seeded into the `categories` table
 * on first run and is fully editable afterwards — rename, recolor, reparent,
 * add your own. Only `isSystem` categories resist deletion, because the
 * classifier needs somewhere to put things it can't place.
 */

export type SeedCategory = {
  slug: string;
  name: string;
  kind: "expense" | "income" | "transfer";
  parent?: string;
  /** Shown to the classifier. Write these as decision rules, not definitions. */
  hint?: string;
  color?: string;
  isSystem?: boolean;
  budgetable?: boolean;

  /** Which chart of accounts. Defaults to personal. */
  mode?: "personal" | "business";
  /** Where this sits in a P&L. Business categories only. */
  plSection?: "revenue" | "cogs" | "opex" | "owner_equity" | "other";
  /** Share of the expense that is deductible, 0-100. See taxonomy-business. */
  deductiblePct?: number;
  /** IRS Schedule C line, informational. */
  scheduleCLine?: string;
};

export const UNCATEGORIZED = "uncategorized";
export const TRANSFER = "transfer";

export const DEFAULT_CATEGORIES: SeedCategory[] = [
  // --- Income --------------------------------------------------------------
  { slug: "income", name: "Income", kind: "income", color: "#1A6B52", budgetable: false },
  {
    slug: "salary",
    name: "Salary & Wages",
    kind: "income",
    parent: "income",
    hint: "Regular paychecks from an employer, including direct deposits labeled PAYROLL or DIR DEP.",
    budgetable: false,
  },
  {
    slug: "freelance-income",
    name: "Freelance & Side Income",
    kind: "income",
    parent: "income",
    hint: "Client payments, contract work, marketplace payouts, Stripe/PayPal deposits you received.",
    budgetable: false,
  },
  {
    slug: "investment-income",
    name: "Interest & Dividends",
    kind: "income",
    parent: "income",
    hint: "Bank interest, dividend payments, brokerage distributions.",
    budgetable: false,
  },
  {
    slug: "refunds",
    name: "Refunds & Reimbursements",
    kind: "income",
    parent: "income",
    hint: "Money coming back: merchant refunds, returns, expense reimbursements, rebates. Also money a person sent you — a Venmo cash-out or an incoming Zelle covering your share of something.",
    budgetable: false,
  },
  {
    slug: "investment-withdrawal",
    name: "Savings & Investment Withdrawals",
    kind: "income",
    parent: "income",
    hint: "Money coming back out of a savings, brokerage or retirement account into checking. The mirror of investments — money you already owned, now liquid.",
    budgetable: false,
  },
  {
    slug: "other-income",
    name: "Other Income",
    kind: "income",
    parent: "income",
    hint: "Any inflow that is not salary, freelance, investment income, or a refund.",
    budgetable: false,
  },

  // --- Housing -------------------------------------------------------------
  { slug: "housing", name: "Housing", kind: "expense", color: "#8B5E3C" },
  {
    slug: "rent-mortgage",
    name: "Rent & Mortgage",
    kind: "expense",
    parent: "housing",
    hint: "Monthly rent or mortgage principal+interest payments to a landlord or servicer.",
  },
  {
    slug: "home-maintenance",
    name: "Home Maintenance",
    kind: "expense",
    parent: "housing",
    hint: "Repairs, contractors, hardware stores, lawn care, cleaning services, HOA dues.",
  },
  {
    slug: "property-tax",
    name: "Property Tax",
    kind: "expense",
    parent: "housing",
    hint: "County or municipal property tax payments.",
  },

  // --- Utilities -----------------------------------------------------------
  { slug: "utilities", name: "Utilities", kind: "expense", color: "#4A7BA7" },
  {
    slug: "electric-gas",
    name: "Electric & Gas",
    kind: "expense",
    parent: "utilities",
    hint: "Power and natural gas utility bills.",
  },
  {
    slug: "water-trash",
    name: "Water & Trash",
    kind: "expense",
    parent: "utilities",
    hint: "Water, sewer, garbage and recycling services.",
  },
  {
    slug: "internet",
    name: "Internet & Cable",
    kind: "expense",
    parent: "utilities",
    hint: "Home broadband and cable TV service.",
  },
  {
    slug: "mobile-phone",
    name: "Mobile Phone",
    kind: "expense",
    parent: "utilities",
    hint: "Cell carrier bills and prepaid phone top-ups.",
  },

  // --- Food ----------------------------------------------------------------
  { slug: "food", name: "Food & Dining", kind: "expense", color: "#C2703D" },
  {
    slug: "groceries",
    name: "Groceries",
    kind: "expense",
    parent: "food",
    hint: "Supermarkets and grocery stores. Warehouse clubs default here unless clearly fuel.",
  },
  {
    slug: "restaurants",
    name: "Restaurants",
    kind: "expense",
    parent: "food",
    hint: "Sit-down and fast-food restaurants, cafeterias, food trucks.",
  },
  {
    slug: "coffee",
    name: "Coffee Shops",
    kind: "expense",
    parent: "food",
    hint: "Coffee and tea shops, including chains and independents.",
  },
  {
    slug: "food-delivery",
    name: "Food Delivery",
    kind: "expense",
    parent: "food",
    hint: "Delivery platforms and meal kits: DoorDash, Uber Eats, Instacart, HelloFresh.",
  },
  {
    slug: "alcohol-bars",
    name: "Bars & Alcohol",
    kind: "expense",
    parent: "food",
    hint: "Bars, breweries, taprooms, liquor stores, wine shops.",
  },

  // --- Transportation ------------------------------------------------------
  { slug: "transport", name: "Transportation", kind: "expense", color: "#5F7A61" },
  {
    slug: "gas-fuel",
    name: "Gas & Fuel",
    kind: "expense",
    parent: "transport",
    hint: "Gas stations and EV charging networks.",
  },
  {
    slug: "car-payment",
    name: "Car Payment",
    kind: "expense",
    parent: "transport",
    hint: "Auto loan or lease payments.",
  },
  {
    slug: "car-insurance",
    name: "Car Insurance",
    kind: "expense",
    parent: "transport",
    hint: "Auto insurance premiums.",
  },
  {
    slug: "car-maintenance",
    name: "Car Maintenance",
    kind: "expense",
    parent: "transport",
    hint: "Service, repairs, tires, oil changes, car washes, DMV registration.",
  },
  {
    slug: "parking-tolls",
    name: "Parking & Tolls",
    kind: "expense",
    parent: "transport",
    hint: "Parking garages, meters, toll roads and transponder reloads.",
  },
  {
    slug: "rideshare",
    name: "Rideshare & Taxi",
    kind: "expense",
    parent: "transport",
    hint: "Uber, Lyft, taxis, scooter and bike share. Uber Eats is food delivery, not this.",
  },
  {
    slug: "public-transit",
    name: "Public Transit",
    kind: "expense",
    parent: "transport",
    hint: "Bus, subway, commuter rail fares and passes.",
  },

  // --- Shopping ------------------------------------------------------------
  { slug: "shopping", name: "Shopping", kind: "expense", color: "#9B6A9E" },
  {
    slug: "general-merchandise",
    name: "General Merchandise",
    kind: "expense",
    parent: "shopping",
    hint: "Broad retailers and marketplaces where the item is unknown: Amazon, Target, Walmart.",
  },
  {
    slug: "clothing",
    name: "Clothing",
    kind: "expense",
    parent: "shopping",
    hint: "Apparel, shoes, accessories.",
  },
  {
    slug: "electronics",
    name: "Electronics",
    kind: "expense",
    parent: "shopping",
    hint: "Consumer electronics, computers, phones, components.",
  },
  {
    slug: "home-goods",
    name: "Home & Furniture",
    kind: "expense",
    parent: "shopping",
    hint: "Furniture, decor, kitchenware, bedding, home improvement retail.",
  },
  {
    slug: "hobbies",
    name: "Hobbies & Recreation",
    kind: "expense",
    parent: "shopping",
    hint: "Sporting goods, crafts, games, books, music gear, outdoor equipment.",
  },

  // --- Health --------------------------------------------------------------
  { slug: "health", name: "Health", kind: "expense", color: "#C25E5E" },
  {
    slug: "medical",
    name: "Medical",
    kind: "expense",
    parent: "health",
    hint: "Doctor visits, hospitals, labs, specialists, copays.",
  },
  {
    slug: "pharmacy",
    name: "Pharmacy",
    kind: "expense",
    parent: "health",
    hint: "Prescriptions and drugstore purchases.",
  },
  {
    slug: "dental-vision",
    name: "Dental & Vision",
    kind: "expense",
    parent: "health",
    hint: "Dentists, orthodontists, optometrists, glasses and contacts.",
  },
  {
    slug: "fitness",
    name: "Fitness",
    kind: "expense",
    parent: "health",
    hint: "Gyms, studios, fitness apps and classes.",
  },
  {
    slug: "health-insurance",
    name: "Health Insurance",
    kind: "expense",
    parent: "health",
    hint: "Medical, dental or vision insurance premiums.",
  },

  // --- Subscriptions -------------------------------------------------------
  { slug: "subscriptions", name: "Subscriptions", kind: "expense", color: "#3F7D8C" },
  {
    slug: "streaming",
    name: "Streaming",
    kind: "expense",
    parent: "subscriptions",
    hint: "Video and music streaming services.",
  },
  {
    slug: "software",
    name: "Software & Cloud",
    kind: "expense",
    parent: "subscriptions",
    hint: "SaaS tools, app subscriptions, cloud hosting, domains, AI services.",
  },
  {
    slug: "news-media",
    name: "News & Media",
    kind: "expense",
    parent: "subscriptions",
    hint: "Newspaper, magazine and newsletter subscriptions.",
  },
  {
    slug: "memberships",
    name: "Memberships",
    kind: "expense",
    parent: "subscriptions",
    hint: "Warehouse club fees, professional associations, recurring memberships.",
  },

  // --- Personal ------------------------------------------------------------
  { slug: "personal", name: "Personal", kind: "expense", color: "#B08968" },
  {
    slug: "personal-care",
    name: "Personal Care",
    kind: "expense",
    parent: "personal",
    hint: "Hair, nails, spa, barber, cosmetics.",
  },
  {
    slug: "education",
    name: "Education",
    kind: "expense",
    parent: "personal",
    hint: "Tuition, courses, textbooks, student loan payments.",
  },
  {
    slug: "childcare",
    name: "Childcare & Kids",
    kind: "expense",
    parent: "personal",
    hint: "Daycare, babysitting, school fees, kids' activities.",
  },
  {
    slug: "pets",
    name: "Pets",
    kind: "expense",
    parent: "personal",
    hint: "Vet, pet food, grooming, boarding, pet supplies.",
  },
  {
    slug: "person-to-person",
    name: "Person-to-Person Payments",
    kind: "expense",
    parent: "personal",
    hint: "Money sent to a person through Venmo, Zelle, Cash App or PayPal when the description does not say what it was for. Real spending, and a holding place, not an answer — the user is asked to refile it. Prefer a category that names the purpose whenever the description supports one.",
  },
  {
    slug: "gifts-donations",
    name: "Gifts & Donations",
    kind: "expense",
    parent: "personal",
    hint: "Charitable giving, religious donations, gifts to people.",
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    kind: "expense",
    parent: "personal",
    hint: "Movies, concerts, events, ticketing, museums, gaming purchases.",
  },

  // --- Travel --------------------------------------------------------------
  { slug: "travel", name: "Travel", kind: "expense", color: "#7A6BA7" },
  {
    slug: "flights",
    name: "Flights",
    kind: "expense",
    parent: "travel",
    hint: "Airline tickets, seat and bag fees.",
  },
  {
    slug: "lodging",
    name: "Hotels & Lodging",
    kind: "expense",
    parent: "travel",
    hint: "Hotels, Airbnb, Vrbo, campgrounds.",
  },
  {
    slug: "travel-other",
    name: "Other Travel",
    kind: "expense",
    parent: "travel",
    hint: "Rental cars, travel insurance, baggage, tours, foreign transaction fees on trips.",
  },

  // --- Financial -----------------------------------------------------------
  { slug: "financial", name: "Financial", kind: "expense", color: "#6B6862" },
  {
    slug: "bank-fees",
    name: "Bank Fees",
    kind: "expense",
    parent: "financial",
    hint: "Monthly maintenance, overdraft, ATM, wire and foreign transaction fees.",
  },
  {
    slug: "interest-charge",
    name: "Interest Charges",
    kind: "expense",
    parent: "financial",
    hint: "Credit card and loan interest charged to the account.",
  },
  {
    slug: "taxes",
    name: "Taxes",
    kind: "expense",
    parent: "financial",
    hint: "Income tax payments to IRS or a state revenue department.",
  },
  {
    slug: "insurance-other",
    name: "Other Insurance",
    kind: "expense",
    parent: "financial",
    hint: "Renters, homeowners, life and umbrella insurance premiums.",
  },
  {
    slug: "loan-payment",
    name: "Loan Payments",
    kind: "expense",
    parent: "financial",
    hint: "Personal loan and non-auto, non-student debt payments.",
  },
  {
    slug: "investments",
    name: "Investments & Savings",
    kind: "expense",
    parent: "financial",
    hint: "Money moving out of checking into a brokerage, retirement or savings vehicle. Money you still own. For the return trip use investment-withdrawal.",
    budgetable: false,
  },
  {
    slug: "debt-payment",
    name: "Debt Payments",
    kind: "expense",
    parent: "financial",
    hint: "A payment toward a credit card or loan whose own transactions are NOT in this ledger. Counted as spending, because nothing else represents where that money went. This is a stand-in for unknown purchases, not a category the classifier should choose from a description — see reconcileCardPayments.",
  },
  {
    slug: "card-payment",
    name: "Credit Card Payments",
    kind: "transfer",
    parent: "financial",
    hint: "Paying down a credit card balance: 'Payment to Chase card ending in 1234', 'CAPITAL ONE MOBILE PMT', 'AUTOPAY PAYMENT', 'PAYMENT THANK YOU'. Always set is_transfer — the purchases on that card are the spending, and counting the payment as well would count the same money twice. Applies to both sides: the debit leaving checking and the credit arriving on the card.",
    budgetable: false,
  },
  {
    slug: "cash-withdrawal",
    name: "Cash Withdrawals",
    kind: "expense",
    parent: "financial",
    hint: "ATM and teller withdrawals. The cash was spent on something the statement cannot see, so this stands in for it.",
  },

  // --- System --------------------------------------------------------------
  {
    slug: TRANSFER,
    name: "Internal Transfers",
    kind: "transfer",
    color: "#8A8780",
    hint: "ONLY a move between two accounts the same person owns, where the description names the other account: 'Online Transfer to CHK ...1234', 'Transfer to Savings'. This is the one category excluded from totals, so nothing belongs here unless the money is still the person's and is visible on the other side. Paying a person, a card issuer or an ATM is not this.",
    isSystem: true,
    budgetable: false,
  },
  {
    slug: UNCATEGORIZED,
    name: "Uncategorized",
    kind: "expense",
    color: "#A8A49B",
    hint: "Only when there is genuinely not enough information to choose any other category.",
    isSystem: true,
    budgetable: false,
  },
];

// ---------------------------------------------------------------------------
// Seed rules
// ---------------------------------------------------------------------------

export type SeedRule = {
  pattern: string;
  /**
   * `null` makes this a merchant-only rule: it names the merchant and defers
   * the category to the model. Payment rails need this — "venmo" identifies
   * how the money moved and says nothing about what it bought.
   */
  category: string | null;
  merchant?: string;
  matchType?: "contains" | "prefix" | "exact" | "regex";
  /** Seeds sit at 100. Learned rules are written at 200 so they always win. */
  priority?: number;
  /** Restrict to money out ("debit") or money in ("credit"). */
  appliesTo?: "any" | "debit" | "credit";
  /** Skip the model and put it in the review queue for the user to answer. */
  queueForReview?: boolean;
  isTransfer?: boolean;
  /** Which chart of accounts. Defaults to personal. */
  mode?: "personal" | "business";
};

/**
 * Merchants common enough to be worth matching without a model call. This list
 * is deliberately conservative: an ambiguous merchant is better handed to the
 * classifier than pinned to a wrong category by a cheap string match.
 */
export const SEED_RULES: SeedRule[] = [
  /*
   * Internal transfers — the only rows excluded from totals. Each one has to
   * name the other account, because that is the whole justification for
   * dropping it: the money is still the person's and shows up on the other
   * side. "chk ..." and "sav ..." are what Chase's "Online Transfer to
   * CHK ...1234" normalizes to once the leading "online transfer to" is
   * stripped.
   */
  { pattern: "internal transfer", category: TRANSFER, priority: 150, isTransfer: true },
  { pattern: "transfer to savings", category: TRANSFER, priority: 150, isTransfer: true },
  { pattern: "chk ...", category: TRANSFER, priority: 150, isTransfer: true },
  { pattern: "sav ...", category: TRANSFER, priority: 150, isTransfer: true },

  /*
   * Credit card payments, excluded from totals.
   *
   * The swipe is the expense; the payment only settles the balance. Counting
   * both charges the same dollar twice — once when the card was used and again
   * when the bill was paid — which is exactly what makes a budget unusable.
   *
   * Every one of these appears twice in a complete ledger: as a debit on the
   * checking statement ("Payment to Chase card ending in 1234") and as a
   * credit on the card's own ("PAYMENT THANK YOU"). Both sides are flagged, so
   * the payment neither inflates spending nor shows up as income.
   */
  { pattern: "payment thank you", category: "card-payment", priority: 150, isTransfer: true },
  { pattern: "autopay payment", category: "card-payment", priority: 150, isTransfer: true },
  { pattern: "online payment from", category: "card-payment", priority: 150, isTransfer: true },
  { pattern: "credit card payment", category: "card-payment", priority: 150, isTransfer: true },
  { pattern: "card ending in", category: "card-payment", priority: 150, isTransfer: true },
  { pattern: "mobile pmt", category: "card-payment", priority: 152, isTransfer: true },
  /*
   * Scoped to debits, unlike the rules above it.
   *
   * Those all name a payment outright ("payment thank you", "autopay
   * payment"), so they are safe in either direction. This one is a bare
   * issuer name, and money arriving *from* Capital One is a cashback
   * redemption or a refund — income. Left unscoped, the transfer flag would
   * delete it from the income total on the strength of the word "Capital".
   *
   * The priority still has to outrank the "mobil" gas rule, which
   * "CAPITAL ONE MOBILE PMT" contains.
   */
  { pattern: "capital one", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Capital One" },

  /*
   * Issuer-specific payment descriptors.
   *
   * The ones that spell out a *payment* ("epayment", "autopay") are safe in
   * either direction, the same standard "payment thank you" meets. The ones
   * that only name the card are scoped to debits like Capital One above:
   * money arriving from an issuer is cashback or a refund, and the card side
   * of a real payment is already caught by the issuer-agnostic rules above.
   *
   * The list is deliberately broad rather than the handful any one household
   * happens to use: an unmatched payment is counted as spending twice, and
   * nothing about the resulting total looks wrong.
   */
  { pattern: "chase credit crd", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Chase" },
  { pattern: "amex epayment", category: "card-payment", priority: 150, isTransfer: true, merchant: "American Express" },
  { pattern: "amex e-payment", category: "card-payment", priority: 150, isTransfer: true, merchant: "American Express" },
  { pattern: "american express payment", category: "card-payment", priority: 150, isTransfer: true, merchant: "American Express" },
  { pattern: "discover e-payment", category: "card-payment", priority: 150, isTransfer: true, merchant: "Discover" },
  { pattern: "discover epayment", category: "card-payment", priority: 150, isTransfer: true, merchant: "Discover" },
  { pattern: "citi autopay", category: "card-payment", priority: 150, isTransfer: true, merchant: "Citi" },
  { pattern: "citi card payment", category: "card-payment", priority: 150, isTransfer: true, merchant: "Citi" },
  { pattern: "bk of amer visa", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Bank of America" },
  { pattern: "bank of america credit card", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Bank of America" },
  { pattern: "wells fargo credit card", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Wells Fargo" },
  { pattern: "synchrony bank cc", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Synchrony" },
  { pattern: "barclaycard payment", category: "card-payment", priority: 150, isTransfer: true, merchant: "Barclays" },
  { pattern: "usaa credit card", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "USAA" },
  { pattern: "navy federal credit card", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Navy Federal" },
  { pattern: "us bank credit card", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "U.S. Bank" },
  { pattern: "pnc credit card", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "PNC" },
  { pattern: "truist credit card", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Truist" },
  { pattern: "applecard gsbank", category: "card-payment", priority: 150, appliesTo: "debit", isTransfer: true, merchant: "Apple Card" },
  { pattern: "apple card payment", category: "card-payment", priority: 150, isTransfer: true, merchant: "Apple Card" },

  // Cash out of the account. Where it went is invisible, but it was spent.
  { pattern: "atm withdrawal", category: "cash-withdrawal", priority: 150, merchant: "ATM" },
  { pattern: "atm cash withdrawal", category: "cash-withdrawal", priority: 150, merchant: "ATM" },

  /*
   * Savings and brokerage. Direction decides the category: the same
   * description carries money both ways.
   */
  { pattern: "ally bank", category: "investments", priority: 145, appliesTo: "debit", merchant: "Ally Bank" },
  { pattern: "ally bank", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Ally Bank" },
  { pattern: "fid bkg svc", category: "investments", priority: 145, appliesTo: "debit", merchant: "Fidelity" },
  { pattern: "fid bkg svc", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Fidelity" },
  { pattern: "vanguard", category: "investments", priority: 145, appliesTo: "debit", merchant: "Vanguard" },
  { pattern: "vanguard", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Vanguard" },
  { pattern: "schwab", category: "investments", priority: 145, appliesTo: "debit", merchant: "Schwab" },
  { pattern: "schwab", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Schwab" },
  { pattern: "wealthfront", category: "investments", priority: 145, appliesTo: "debit", merchant: "Wealthfront" },
  { pattern: "wealthfront", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Wealthfront" },
  { pattern: "fidelity", category: "investments", priority: 145, appliesTo: "debit", merchant: "Fidelity" },
  { pattern: "fidelity", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Fidelity" },
  { pattern: "etrade", category: "investments", priority: 145, appliesTo: "debit", merchant: "E*TRADE" },
  { pattern: "etrade", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "E*TRADE" },
  { pattern: "e\\*trade", category: "investments", priority: 145, appliesTo: "debit", merchant: "E*TRADE" },
  { pattern: "e\\*trade", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "E*TRADE" },
  { pattern: "robinhood", category: "investments", priority: 145, appliesTo: "debit", merchant: "Robinhood" },
  { pattern: "robinhood", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Robinhood" },
  { pattern: "betterment", category: "investments", priority: 145, appliesTo: "debit", merchant: "Betterment" },
  { pattern: "betterment", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Betterment" },
  { pattern: "merrill", category: "investments", priority: 145, appliesTo: "debit", merchant: "Merrill" },
  { pattern: "merrill", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Merrill" },
  { pattern: "tiaa", category: "investments", priority: 145, appliesTo: "debit", merchant: "TIAA" },
  { pattern: "tiaa", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "TIAA" },
  { pattern: "empower", category: "investments", priority: 145, appliesTo: "debit", merchant: "Empower" },
  { pattern: "empower", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Empower" },
  { pattern: "rowe price", category: "investments", priority: 145, appliesTo: "debit", merchant: "T. Rowe Price" },
  { pattern: "rowe price", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "T. Rowe Price" },
  { pattern: "edward jones", category: "investments", priority: 145, appliesTo: "debit", merchant: "Edward Jones" },
  { pattern: "edward jones", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Edward Jones" },
  { pattern: "raymond james", category: "investments", priority: 145, appliesTo: "debit", merchant: "Raymond James" },
  { pattern: "raymond james", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Raymond James" },
  { pattern: "interactive brokers", category: "investments", priority: 145, appliesTo: "debit", merchant: "Interactive Brokers" },
  { pattern: "interactive brokers", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Interactive Brokers" },
  { pattern: "m1 finance", category: "investments", priority: 145, appliesTo: "debit", merchant: "M1 Finance" },
  { pattern: "m1 finance", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "M1 Finance" },
  { pattern: "acorns", category: "investments", priority: 145, appliesTo: "debit", merchant: "Acorns" },
  { pattern: "acorns", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Acorns" },
  { pattern: "\\bsofi\\b", matchType: "regex", category: "investments", priority: 145, appliesTo: "debit", merchant: "SoFi" },
  { pattern: "\\bsofi\\b", matchType: "regex", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "SoFi" },
  { pattern: "\\bstash\\b", matchType: "regex", category: "investments", priority: 145, appliesTo: "debit", merchant: "Stash" },
  { pattern: "\\bstash\\b", matchType: "regex", category: "investment-withdrawal", priority: 145, appliesTo: "credit", merchant: "Stash" },

  /*
   * Person-to-person rails.
   *
   * These deliberately set a merchant and nothing else — no category, no
   * transfer flag. Venmo is not a category any more than a debit card is; the
   * rail says how the money moved, never what it bought. Sending $3,000 for
   * trees is spending, and pinning it to Transfers hid exactly that.
   *
   * A payment out is charged as an expense and queued for the user.
   *
   * Both halves matter. It is spending the moment it leaves, so it lands in a
   * real, budgetable category straight away rather than waiting to be labelled
   * — an unanswered question must never quietly cost the month's total.
   * `person-to-person` is a holding place, not an answer, which is why the row
   * is queued at the same time.
   *
   * Queued rather than sent to the model because "Zelle payment to JORDAN
   * 30000000000" is a name and a reference number: there is nothing in it to
   * reason from, and the model answers Uncategorized every time. Asking spends
   * a call to reach the same place, so ask the person, who is the only one who
   * knows what they bought.
   *
   * One answer is enough: correcting a queued row writes a learned rule at
   * priority 200 keyed to the counterparty, which outranks these and
   * classifies that person's future payments automatically.
   */
  { pattern: "zelle", category: "person-to-person", priority: 138, appliesTo: "debit", merchant: "Zelle", queueForReview: true },
  { pattern: "venmo", category: "person-to-person", priority: 138, appliesTo: "debit", merchant: "Venmo", queueForReview: true },
  { pattern: "cash app", category: "person-to-person", priority: 138, appliesTo: "debit", merchant: "Cash App", queueForReview: true },
  { pattern: "zelle payment from", category: "refunds", priority: 140, appliesTo: "credit", merchant: "Zelle" },
  { pattern: "venmo cashout", category: "refunds", priority: 142, appliesTo: "credit", merchant: "Venmo" },

  // Groceries
  { pattern: "trader joe", category: "groceries", merchant: "Trader Joe's" },
  { pattern: "whole foods", category: "groceries", merchant: "Whole Foods" },
  { pattern: "safeway", category: "groceries", merchant: "Safeway" },
  { pattern: "kroger", category: "groceries", merchant: "Kroger" },
  { pattern: "albertsons", category: "groceries", merchant: "Albertsons" },
  { pattern: "publix", category: "groceries", merchant: "Publix" },
  { pattern: "wegmans", category: "groceries", merchant: "Wegmans" },
  { pattern: "aldi", category: "groceries", merchant: "Aldi" },
  { pattern: "sprouts", category: "groceries", merchant: "Sprouts" },
  { pattern: "king soopers", category: "groceries", merchant: "King Soopers" },
  { pattern: "h-e-b", category: "groceries", merchant: "H-E-B" },
  { pattern: "food lion", category: "groceries", merchant: "Food Lion" },
  { pattern: "giant eagle", category: "groceries", merchant: "Giant Eagle" },
  { pattern: "stop shop", category: "groceries", merchant: "Stop & Shop" },
  { pattern: "harris teeter", category: "groceries", merchant: "Harris Teeter" },

  // Coffee
  { pattern: "starbucks", category: "coffee", merchant: "Starbucks" },
  { pattern: "dunkin", category: "coffee", merchant: "Dunkin'" },
  { pattern: "peet", category: "coffee", merchant: "Peet's Coffee" },
  { pattern: "blue bottle", category: "coffee", merchant: "Blue Bottle" },
  { pattern: "caribou coffee", category: "coffee", merchant: "Caribou Coffee" },
  { pattern: "philz", category: "coffee", merchant: "Philz Coffee" },

  // Restaurants & fast food
  { pattern: "chipotle", category: "restaurants", merchant: "Chipotle" },
  { pattern: "mcdonald", category: "restaurants", merchant: "McDonald's" },
  { pattern: "taco bell", category: "restaurants", merchant: "Taco Bell" },
  { pattern: "chick-fil-a", category: "restaurants", merchant: "Chick-fil-A" },
  { pattern: "subway", category: "restaurants", merchant: "Subway" },
  { pattern: "panera", category: "restaurants", merchant: "Panera" },
  { pattern: "sweetgreen", category: "restaurants", merchant: "Sweetgreen" },
  { pattern: "shake shack", category: "restaurants", merchant: "Shake Shack" },
  { pattern: "five guys", category: "restaurants", merchant: "Five Guys" },
  { pattern: "wendy", category: "restaurants", merchant: "Wendy's" },
  { pattern: "burger king", category: "restaurants", merchant: "Burger King" },
  { pattern: "popeyes", category: "restaurants", merchant: "Popeyes" },
  { pattern: "in-n-out", category: "restaurants", merchant: "In-N-Out" },
  { pattern: "olive garden", category: "restaurants", merchant: "Olive Garden" },
  { pattern: "cheesecake factory", category: "restaurants", merchant: "Cheesecake Factory" },

  // Food delivery
  { pattern: "doordash", category: "food-delivery", merchant: "DoorDash" },
  { pattern: "grubhub", category: "food-delivery", merchant: "Grubhub" },
  { pattern: "postmates", category: "food-delivery", merchant: "Postmates" },
  { pattern: "instacart", category: "food-delivery", merchant: "Instacart" },
  { pattern: "hellofresh", category: "food-delivery", merchant: "HelloFresh" },
  { pattern: "blue apron", category: "food-delivery", merchant: "Blue Apron" },
  { pattern: "seamless", category: "food-delivery", merchant: "Seamless" },
  // Ordered before the generic "uber" rule so Eats is not read as a ride.
  { pattern: "uber eats", category: "food-delivery", merchant: "Uber Eats", priority: 130 },
  { pattern: "ubereats", category: "food-delivery", merchant: "Uber Eats", priority: 130 },

  // Bars & alcohol
  { pattern: "total wine", category: "alcohol-bars", merchant: "Total Wine" },
  { pattern: "bevmo", category: "alcohol-bars", merchant: "BevMo" },
  { pattern: "liquor", category: "alcohol-bars" },
  { pattern: "brewing", category: "alcohol-bars" },
  { pattern: "taproom", category: "alcohol-bars" },

  // Rideshare & transit
  { pattern: "lyft", category: "rideshare", merchant: "Lyft" },
  { pattern: "uber", category: "rideshare", merchant: "Uber", priority: 90 },
  { pattern: "bird ride", category: "rideshare", merchant: "Bird" },
  { pattern: "lime ride", category: "rideshare", merchant: "Lime" },
  { pattern: "metro transit", category: "public-transit" },
  { pattern: "amtrak", category: "public-transit", merchant: "Amtrak" },
  { pattern: "clipper", category: "public-transit", merchant: "Clipper" },
  { pattern: "bart", category: "public-transit", merchant: "BART" },
  { pattern: "mta", category: "public-transit", merchant: "MTA" },

  // Gas & EV
  { pattern: "shell oil", category: "gas-fuel", merchant: "Shell" },
  { pattern: "chevron", category: "gas-fuel", merchant: "Chevron" },
  { pattern: "exxon", category: "gas-fuel", merchant: "Exxon" },
  // Anchored: a bare "mobil" substring also sits inside "MOBILE PMT", which
  // filed a $1,430 Capital One card payment as gas.
  { pattern: "\\bmobil\\b", matchType: "regex", category: "gas-fuel", merchant: "Mobil" },
  { pattern: "bp ", category: "gas-fuel", merchant: "BP" },
  { pattern: "arco", category: "gas-fuel", merchant: "ARCO" },
  { pattern: "valero", category: "gas-fuel", merchant: "Valero" },
  { pattern: "circle k", category: "gas-fuel", merchant: "Circle K" },
  { pattern: "wawa", category: "gas-fuel", merchant: "Wawa" },
  { pattern: "quiktrip", category: "gas-fuel", merchant: "QuikTrip" },
  { pattern: "7-eleven", category: "gas-fuel", merchant: "7-Eleven" },
  // Grocery and warehouse chains also sell fuel. These must outrank the
  // chain's own grocery rule, or a tank of gas is filed as groceries.
  { pattern: "king soopers fuel", category: "gas-fuel", merchant: "King Soopers Fuel", priority: 135 },
  { pattern: "kroger fuel", category: "gas-fuel", merchant: "Kroger Fuel", priority: 135 },
  { pattern: "safeway fuel", category: "gas-fuel", merchant: "Safeway Fuel", priority: 135 },
  { pattern: "costco gas", category: "gas-fuel", merchant: "Costco Gas", priority: 135 },
  { pattern: "sams club gas", category: "gas-fuel", merchant: "Sam's Club Gas", priority: 135 },
  { pattern: "murphy usa", category: "gas-fuel", merchant: "Murphy USA", priority: 135 },
  { pattern: "chargepoint", category: "gas-fuel", merchant: "ChargePoint" },
  { pattern: "electrify america", category: "gas-fuel", merchant: "Electrify America" },
  { pattern: "tesla supercharger", category: "gas-fuel", merchant: "Tesla Supercharger" },

  // Parking & tolls
  { pattern: "parkmobile", category: "parking-tolls", merchant: "ParkMobile" },
  { pattern: "spothero", category: "parking-tolls", merchant: "SpotHero" },
  { pattern: "fastrak", category: "parking-tolls", merchant: "FasTrak" },
  { pattern: "e-zpass", category: "parking-tolls", merchant: "E-ZPass" },
  { pattern: "ezpass", category: "parking-tolls", merchant: "E-ZPass" },

  // Car
  { pattern: "jiffy lube", category: "car-maintenance", merchant: "Jiffy Lube" },
  { pattern: "discount tire", category: "car-maintenance", merchant: "Discount Tire" },
  { pattern: "autozone", category: "car-maintenance", merchant: "AutoZone" },
  { pattern: "o'reilly auto", category: "car-maintenance", merchant: "O'Reilly" },
  { pattern: "valvoline", category: "car-maintenance", merchant: "Valvoline" },
  { pattern: "geico", category: "car-insurance", merchant: "GEICO" },
  { pattern: "progressive ins", category: "car-insurance", merchant: "Progressive" },
  { pattern: "state farm", category: "car-insurance", merchant: "State Farm" },
  { pattern: "allstate", category: "car-insurance", merchant: "Allstate" },

  // Streaming & subscriptions
  { pattern: "netflix", category: "streaming", merchant: "Netflix" },
  { pattern: "spotify", category: "streaming", merchant: "Spotify" },
  { pattern: "hulu", category: "streaming", merchant: "Hulu" },
  { pattern: "disney plus", category: "streaming", merchant: "Disney+" },
  { pattern: "disney+", category: "streaming", merchant: "Disney+" },
  { pattern: "hbo max", category: "streaming", merchant: "HBO Max" },
  { pattern: "max.com", category: "streaming", merchant: "Max" },
  { pattern: "paramount+", category: "streaming", merchant: "Paramount+" },
  { pattern: "peacock", category: "streaming", merchant: "Peacock" },
  { pattern: "youtube premium", category: "streaming", merchant: "YouTube Premium" },
  { pattern: "apple music", category: "streaming", merchant: "Apple Music" },
  { pattern: "audible", category: "streaming", merchant: "Audible" },

  { pattern: "adobe", category: "software", merchant: "Adobe" },
  { pattern: "github", category: "software", merchant: "GitHub" },
  { pattern: "notion", category: "software", merchant: "Notion" },
  { pattern: "figma", category: "software", merchant: "Figma" },
  { pattern: "dropbox", category: "software", merchant: "Dropbox" },
  { pattern: "google storage", category: "software", merchant: "Google One" },
  { pattern: "google one", category: "software", merchant: "Google One" },
  { pattern: "icloud", category: "software", merchant: "iCloud" },
  { pattern: "openai", category: "software", merchant: "OpenAI" },
  { pattern: "anthropic", category: "software", merchant: "Anthropic" },
  { pattern: "vercel", category: "software", merchant: "Vercel" },
  { pattern: "aws", category: "software", merchant: "AWS" },
  { pattern: "digitalocean", category: "software", merchant: "DigitalOcean" },
  { pattern: "1password", category: "software", merchant: "1Password" },
  { pattern: "namecheap", category: "software", merchant: "Namecheap" },
  { pattern: "godaddy", category: "software", merchant: "GoDaddy" },

  { pattern: "nytimes", category: "news-media", merchant: "New York Times" },
  { pattern: "wsj", category: "news-media", merchant: "Wall Street Journal" },
  { pattern: "washingtonpost", category: "news-media", merchant: "Washington Post" },
  { pattern: "substack", category: "news-media", merchant: "Substack" },
  { pattern: "patreon", category: "news-media", merchant: "Patreon" },

  { pattern: "costco whse", category: "groceries", merchant: "Costco" },
  { pattern: "costco mbrshp", category: "memberships", merchant: "Costco Membership", priority: 130 },
  { pattern: "sams club", category: "groceries", merchant: "Sam's Club" },
  { pattern: "aaa membership", category: "memberships", merchant: "AAA" },

  // Utilities
  { pattern: "comcast", category: "internet", merchant: "Comcast" },
  { pattern: "xfinity", category: "internet", merchant: "Xfinity" },
  { pattern: "spectrum", category: "internet", merchant: "Spectrum" },
  { pattern: "centurylink", category: "internet", merchant: "CenturyLink" },
  { pattern: "google fiber", category: "internet", merchant: "Google Fiber" },
  { pattern: "verizon", category: "mobile-phone", merchant: "Verizon" },
  { pattern: "t-mobile", category: "mobile-phone", merchant: "T-Mobile" },
  { pattern: "at&t", category: "mobile-phone", merchant: "AT&T" },
  { pattern: "mint mobile", category: "mobile-phone", merchant: "Mint Mobile" },
  { pattern: "visible", category: "mobile-phone", merchant: "Visible" },
  { pattern: "pg&e", category: "electric-gas", merchant: "PG&E" },
  { pattern: "xcel energy", category: "electric-gas", merchant: "Xcel Energy" },
  { pattern: "duke energy", category: "electric-gas", merchant: "Duke Energy" },
  { pattern: "con edison", category: "electric-gas", merchant: "Con Edison" },
  { pattern: "national grid", category: "electric-gas", merchant: "National Grid" },

  // Shopping
  { pattern: "amazon", category: "general-merchandise", merchant: "Amazon" },
  { pattern: "target", category: "general-merchandise", merchant: "Target" },
  { pattern: "walmart", category: "general-merchandise", merchant: "Walmart" },
  { pattern: "etsy", category: "general-merchandise", merchant: "Etsy" },
  { pattern: "ebay", category: "general-merchandise", merchant: "eBay" },
  { pattern: "best buy", category: "electronics", merchant: "Best Buy" },
  { pattern: "apple store", category: "electronics", merchant: "Apple" },
  { pattern: "newegg", category: "electronics", merchant: "Newegg" },
  { pattern: "micro center", category: "electronics", merchant: "Micro Center" },
  { pattern: "home depot", category: "home-goods", merchant: "Home Depot" },
  { pattern: "lowes", category: "home-goods", merchant: "Lowe's" },
  { pattern: "ikea", category: "home-goods", merchant: "IKEA" },
  { pattern: "wayfair", category: "home-goods", merchant: "Wayfair" },
  { pattern: "west elm", category: "home-goods", merchant: "West Elm" },
  { pattern: "crate barrel", category: "home-goods", merchant: "Crate & Barrel" },
  { pattern: "nordstrom", category: "clothing", merchant: "Nordstrom" },
  { pattern: "uniqlo", category: "clothing", merchant: "Uniqlo" },
  { pattern: "zara", category: "clothing", merchant: "Zara" },
  { pattern: "h&m", category: "clothing", merchant: "H&M" },
  { pattern: "nike", category: "clothing", merchant: "Nike" },
  { pattern: "lululemon", category: "clothing", merchant: "Lululemon" },
  { pattern: "patagonia", category: "clothing", merchant: "Patagonia" },
  { pattern: "rei", category: "hobbies", merchant: "REI" },
  { pattern: "dick's sporting", category: "hobbies", merchant: "Dick's Sporting Goods" },
  { pattern: "steam games", category: "hobbies", merchant: "Steam" },
  { pattern: "nintendo", category: "hobbies", merchant: "Nintendo" },
  { pattern: "playstation", category: "hobbies", merchant: "PlayStation" },

  // Health
  { pattern: "cvs", category: "pharmacy", merchant: "CVS" },
  { pattern: "walgreens", category: "pharmacy", merchant: "Walgreens" },
  { pattern: "rite aid", category: "pharmacy", merchant: "Rite Aid" },
  { pattern: "goodrx", category: "pharmacy", merchant: "GoodRx" },
  { pattern: "planet fitness", category: "fitness", merchant: "Planet Fitness" },
  { pattern: "equinox", category: "fitness", merchant: "Equinox" },
  { pattern: "orangetheory", category: "fitness", merchant: "Orangetheory" },
  { pattern: "peloton", category: "fitness", merchant: "Peloton" },
  { pattern: "classpass", category: "fitness", merchant: "ClassPass" },
  { pattern: "24 hour fitness", category: "fitness", merchant: "24 Hour Fitness" },
  { pattern: "lifetime fitness", category: "fitness", merchant: "Life Time" },

  // Travel
  { pattern: "united airlines", category: "flights", merchant: "United" },
  { pattern: "delta air", category: "flights", merchant: "Delta" },
  { pattern: "american airlines", category: "flights", merchant: "American Airlines" },
  { pattern: "southwest air", category: "flights", merchant: "Southwest" },
  { pattern: "alaska air", category: "flights", merchant: "Alaska Airlines" },
  { pattern: "jetblue", category: "flights", merchant: "JetBlue" },
  { pattern: "airbnb", category: "lodging", merchant: "Airbnb" },
  { pattern: "vrbo", category: "lodging", merchant: "Vrbo" },
  { pattern: "marriott", category: "lodging", merchant: "Marriott" },
  { pattern: "hilton", category: "lodging", merchant: "Hilton" },
  { pattern: "hyatt", category: "lodging", merchant: "Hyatt" },
  { pattern: "booking.com", category: "lodging", merchant: "Booking.com" },
  { pattern: "expedia", category: "travel-other", merchant: "Expedia" },
  { pattern: "hertz", category: "travel-other", merchant: "Hertz" },
  { pattern: "enterprise rent", category: "travel-other", merchant: "Enterprise" },

  // Entertainment
  { pattern: "ticketmaster", category: "entertainment", merchant: "Ticketmaster" },
  { pattern: "stubhub", category: "entertainment", merchant: "StubHub" },
  { pattern: "amc theat", category: "entertainment", merchant: "AMC Theatres" },
  { pattern: "regal cinema", category: "entertainment", merchant: "Regal" },
  { pattern: "eventbrite", category: "entertainment", merchant: "Eventbrite" },

  // Pets
  { pattern: "chewy", category: "pets", merchant: "Chewy" },
  { pattern: "petco", category: "pets", merchant: "Petco" },
  { pattern: "petsmart", category: "pets", merchant: "PetSmart" },
  { pattern: "veterinary", category: "pets" },

  // Financial
  { pattern: "overdraft fee", category: "bank-fees", priority: 130 },
  { pattern: "monthly service fee", category: "bank-fees", priority: 130 },
  { pattern: "maintenance fee", category: "bank-fees", priority: 130 },
  { pattern: "atm fee", category: "bank-fees", priority: 130 },
  { pattern: "foreign transaction fee", category: "bank-fees", priority: 130 },
  { pattern: "wire fee", category: "bank-fees", priority: 130 },
  { pattern: "interest charge", category: "interest-charge", priority: 130 },
  { pattern: "finance charge", category: "interest-charge", priority: 130 },
  { pattern: "irs usataxpymt", category: "taxes", merchant: "IRS", priority: 130 },
  { pattern: "vanguard", category: "investments", merchant: "Vanguard" },
  { pattern: "fidelity", category: "investments", merchant: "Fidelity" },
  { pattern: "schwab", category: "investments", merchant: "Schwab" },
  { pattern: "robinhood", category: "investments", merchant: "Robinhood" },
  { pattern: "coinbase", category: "investments", merchant: "Coinbase" },
  { pattern: "wealthfront", category: "investments", merchant: "Wealthfront" },
  { pattern: "betterment", category: "investments", merchant: "Betterment" },

  // Income
  { pattern: "payroll", category: "salary", priority: 130 },
  { pattern: "direct dep", category: "salary", priority: 130 },
  { pattern: "dir dep", category: "salary", priority: 130 },
  { pattern: "stripe transfer", category: "freelance-income", merchant: "Stripe" },
  { pattern: "interest paid", category: "investment-income", priority: 130 },
  { pattern: "dividend", category: "investment-income", priority: 130 },
];
