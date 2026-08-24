import type { SeedCategory, SeedRule } from "./taxonomy";

/**
 * The business chart of accounts.
 *
 * Built around what a sole proprietor or small LLC actually needs at year end:
 * a profit-and-loss statement, and a record of what is deductible and where it
 * goes on the return. The Schedule C line numbers are for a US filer; they are
 * informational, and their job is to make the year-end export legible to an
 * accountant rather than a wall of merchant names.
 *
 * `deductiblePct` is a percentage rather than a flag because the interesting
 * cases are not binary — meals are commonly 50%, a home office is a share of
 * the property, a phone is whatever share is business use. These are defaults
 * to organize records against, not tax advice, and the rates change. Every one
 * is editable.
 *
 * The structural point of the file is `owner-draw`. Paying yourself is not a
 * business expense: it is equity leaving. Filed as an expense it understates
 * profit and overstates deductions, which on a return is not a cosmetic error.
 * It is the business analogue of the transfer flag, and it fails the same way
 * — quietly, in a number that still balances.
 */

export const BUSINESS_UNCATEGORIZED = "biz-uncategorized";
export const OWNER_DRAW = "owner-draw";

export const BUSINESS_CATEGORIES: SeedCategory[] = [
  // --- Revenue -------------------------------------------------------------
  {
    slug: "revenue",
    name: "Revenue",
    kind: "income",
    mode: "business",
    plSection: "revenue",
    color: "#1A6B52",
    budgetable: false,
  },
  {
    slug: "client-revenue",
    name: "Client Payments",
    kind: "income",
    parent: "revenue",
    mode: "business",
    plSection: "revenue",
    scheduleCLine: "1 — Gross receipts",
    hint: "Money from customers for work delivered: invoice payments, retainers, ACH from a client, Stripe or PayPal payouts.",
    budgetable: false,
  },
  {
    slug: "product-revenue",
    name: "Product Sales",
    kind: "income",
    parent: "revenue",
    mode: "business",
    plSection: "revenue",
    scheduleCLine: "1 — Gross receipts",
    hint: "Sales of goods: marketplace payouts, storefront settlements, wholesale invoices.",
    budgetable: false,
  },
  {
    slug: "other-revenue",
    name: "Other Income",
    kind: "income",
    parent: "revenue",
    mode: "business",
    plSection: "other",
    scheduleCLine: "6 — Other income",
    hint: "Interest on business accounts, rebates, grants, settlements. Not sales.",
    budgetable: false,
  },
  {
    slug: "refunds-issued",
    name: "Refunds & Returns",
    kind: "expense",
    parent: "revenue",
    mode: "business",
    plSection: "revenue",
    scheduleCLine: "2 — Returns and allowances",
    hint: "Money refunded to a customer. Reduces revenue rather than being an expense.",
    budgetable: false,
  },

  // --- Cost of goods sold --------------------------------------------------
  {
    slug: "cogs",
    name: "Cost of Goods Sold",
    kind: "expense",
    mode: "business",
    plSection: "cogs",
    color: "#8B5E3C",
  },
  {
    slug: "materials",
    name: "Materials & Supplies",
    kind: "expense",
    parent: "cogs",
    mode: "business",
    plSection: "cogs",
    deductiblePct: 100,
    scheduleCLine: "38 — Materials and supplies",
    hint: "Physical inputs that go into what you sell. Not office supplies, which are overhead.",
  },
  {
    slug: "inventory",
    name: "Inventory Purchases",
    kind: "expense",
    parent: "cogs",
    mode: "business",
    plSection: "cogs",
    deductiblePct: 100,
    scheduleCLine: "36 — Purchases",
    hint: "Goods bought for resale.",
  },
  {
    slug: "subcontractors",
    name: "Subcontractors",
    kind: "expense",
    parent: "cogs",
    mode: "business",
    plSection: "cogs",
    deductiblePct: 100,
    scheduleCLine: "11 — Contract labor",
    hint: "Freelancers and contractors doing billable work. Anyone paid $600+ in a year likely needs a 1099.",
  },
  {
    slug: "merchant-fees",
    name: "Payment Processing",
    kind: "expense",
    parent: "cogs",
    mode: "business",
    plSection: "cogs",
    deductiblePct: 100,
    scheduleCLine: "10 — Commissions and fees",
    hint: "Stripe, Square, PayPal and card processing fees withheld from payouts.",
  },

  // --- Operating expenses --------------------------------------------------
  {
    slug: "operating",
    name: "Operating Expenses",
    kind: "expense",
    mode: "business",
    plSection: "opex",
    color: "#4A7BA7",
  },
  {
    slug: "biz-software",
    name: "Software & Subscriptions",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "18 — Office expense",
    hint: "SaaS, hosting, domains, developer tools, cloud infrastructure, API usage.",
  },
  {
    slug: "biz-rent",
    name: "Rent & Facilities",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "20b — Rent (other business property)",
    hint: "Office, studio, warehouse or coworking rent. A home office belongs in home-office instead.",
  },
  {
    slug: "home-office",
    name: "Home Office",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    // A share of the home, not the whole bill. The real percentage is the
    // business-use area, so this default is deliberately conservative.
    deductiblePct: 20,
    scheduleCLine: "30 — Business use of home",
    hint: "The business share of household costs when working from home. Set the percentage to your actual business-use share.",
  },
  {
    slug: "biz-utilities",
    name: "Utilities",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "25 — Utilities",
    hint: "Power, water and internet for a business premises.",
  },
  {
    slug: "biz-phone",
    name: "Phone & Internet",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    // Mixed use is the norm, so the default assumes a split rather than
    // silently claiming the whole bill.
    deductiblePct: 50,
    scheduleCLine: "25 — Utilities",
    hint: "Mobile and broadband. Deduct only the business-use share unless the line is business-only.",
  },
  {
    slug: "professional-services",
    name: "Professional Services",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "17 — Legal and professional services",
    hint: "Accountants, bookkeepers, lawyers, consultants, tax preparation.",
  },
  {
    slug: "marketing",
    name: "Marketing & Advertising",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "8 — Advertising",
    hint: "Ad spend, sponsorships, design, print, promotional goods, SEO and content services.",
  },
  {
    slug: "biz-travel",
    name: "Travel",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "24a — Travel",
    hint: "Flights, hotels and ground transport for business trips. Meals while travelling go in business-meals.",
  },
  {
    slug: "business-meals",
    name: "Meals & Entertainment",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    // The long-standing default. Entertainment is generally not deductible at
    // all, which is why the hint says to split them.
    deductiblePct: 50,
    scheduleCLine: "24b — Deductible meals",
    hint: "Meals with clients or while travelling for business. Usually 50% deductible. Pure entertainment is generally not deductible — keep it separate.",
  },
  {
    slug: "vehicle",
    name: "Vehicle & Mileage",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "9 — Car and truck expenses",
    hint: "Fuel, maintenance, parking and tolls for business driving. Only the business-use share counts, and mileage records matter.",
  },
  {
    slug: "biz-insurance",
    name: "Insurance",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "15 — Insurance (other than health)",
    hint: "Liability, professional indemnity, business property, errors and omissions.",
  },
  {
    slug: "payroll",
    name: "Payroll & Wages",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "26 — Wages",
    hint: "Employee wages and payroll runs. An owner's draw is not payroll — see owner-draw.",
  },
  {
    slug: "payroll-taxes",
    name: "Payroll Taxes",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "23 — Taxes and licenses",
    hint: "Employer-side payroll tax, unemployment insurance, workers' compensation.",
  },
  {
    slug: "biz-equipment",
    name: "Equipment",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "13 — Depreciation / Section 179",
    hint: "Computers, tools, furniture, cameras. Larger purchases may be depreciated rather than expensed in one year — flag them for your accountant.",
  },
  {
    slug: "biz-supplies",
    name: "Office Supplies",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "18 — Office expense",
    hint: "Consumables and small office goods: paper, postage, printer ink, cleaning.",
  },
  {
    // Prefixed because slugs are globally unique across both charts, and the
    // personal taxonomy already owns "education". Without the prefix, seeding
    // converted the household category into a business one — silently, since
    // the upsert matches on slug alone.
    slug: "biz-education",
    name: "Education & Training",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "27a — Other expenses",
    hint: "Courses, conferences, books and certifications that maintain or improve skills for the current business.",
  },
  {
    slug: "licenses",
    name: "Licenses & Permits",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "23 — Taxes and licenses",
    hint: "Business registration, professional licences, permits, trademark and filing fees.",
  },
  {
    slug: "biz-bank-fees",
    name: "Bank & Interest",
    kind: "expense",
    parent: "operating",
    mode: "business",
    plSection: "opex",
    deductiblePct: 100,
    scheduleCLine: "16b — Interest (other)",
    hint: "Business account fees, wire charges, and interest on business loans or credit lines.",
  },

  // --- Owner equity --------------------------------------------------------
  {
    slug: "equity",
    name: "Owner Equity",
    kind: "transfer",
    mode: "business",
    plSection: "owner_equity",
    color: "#8A8780",
    budgetable: false,
  },
  {
    slug: OWNER_DRAW,
    name: "Owner's Draw",
    kind: "transfer",
    parent: "equity",
    mode: "business",
    plSection: "owner_equity",
    isSystem: true,
    budgetable: false,
    hint: "Money the owner takes out of the business for themselves — a transfer to a personal account, a distribution. NOT an expense and NOT deductible: it is profit being withdrawn, not a cost of earning it. Filing it as an expense understates profit and overstates deductions.",
  },
  {
    slug: "owner-contribution",
    name: "Owner Contribution",
    kind: "transfer",
    parent: "equity",
    mode: "business",
    plSection: "owner_equity",
    budgetable: false,
    hint: "Personal money put into the business. Not revenue — nobody paid you for anything.",
  },
  {
    slug: "estimated-taxes",
    name: "Estimated Tax Payments",
    kind: "transfer",
    parent: "equity",
    mode: "business",
    plSection: "owner_equity",
    budgetable: false,
    hint: "Quarterly income tax paid to the IRS or a state. For a sole proprietor this is personal tax on business profit, so it is not a business expense.",
  },

  // --- System --------------------------------------------------------------
  {
    slug: BUSINESS_UNCATEGORIZED,
    name: "Uncategorized",
    kind: "expense",
    mode: "business",
    plSection: "opex",
    color: "#A8A49B",
    isSystem: true,
    budgetable: false,
    hint: "Only when there is genuinely not enough information to choose any other category.",
  },
  {
    slug: "biz-transfer",
    name: "Internal Transfers",
    kind: "transfer",
    mode: "business",
    plSection: "owner_equity",
    color: "#8A8780",
    isSystem: true,
    budgetable: false,
    hint: "Movement between two accounts the business owns, and credit card payments. Never counted in the P&L.",
  },
];

/**
 * Business seed rules.
 *
 * Deliberately thinner than the personal set. A business ledger's merchants
 * are specific to the business, so most of the value comes from the learning
 * loop rather than from guesses shipped in the box. What is here is the
 * infrastructure every small business touches, plus the rows that are
 * dangerous to get wrong.
 */
const BUSINESS_RULES_RAW: SeedRule[] = [
  // Internal movement and card payments — excluded from the P&L, same rules
  // and same reasoning as the personal ledger.
  { pattern: "internal transfer", category: "biz-transfer", priority: 150, isTransfer: true },
  { pattern: "transfer to savings", category: "biz-transfer", priority: 150, isTransfer: true },
  { pattern: "chk ...", category: "biz-transfer", priority: 150, isTransfer: true },
  { pattern: "sav ...", category: "biz-transfer", priority: 150, isTransfer: true },
  { pattern: "payment thank you", category: "biz-transfer", priority: 150, isTransfer: true },
  { pattern: "autopay payment", category: "biz-transfer", priority: 150, isTransfer: true },
  { pattern: "card ending in", category: "biz-transfer", priority: 150, isTransfer: true },

  /*
   * Tax payments and owner draws. Both leave the business and neither is an
   * expense, so both are flagged — the mistake they prevent is a deduction
   * that does not exist.
   */
  { pattern: "irs usataxpymt", category: "estimated-taxes", priority: 150, isTransfer: true, merchant: "IRS" },
  { pattern: "irs treas", category: "estimated-taxes", priority: 150, isTransfer: true, merchant: "IRS" },
  { pattern: "eftps", category: "estimated-taxes", priority: 150, isTransfer: true, merchant: "EFTPS" },

  // Payment processors, inbound: revenue. Direction-scoped, because the same
  // name going the other way is a fee or a refund.
  { pattern: "stripe", category: "client-revenue", priority: 145, appliesTo: "credit", merchant: "Stripe" },
  { pattern: "square inc", category: "client-revenue", priority: 145, appliesTo: "credit", merchant: "Square" },
  { pattern: "paypal transfer", category: "client-revenue", priority: 145, appliesTo: "credit", merchant: "PayPal" },
  { pattern: "shopify", category: "product-revenue", priority: 145, appliesTo: "credit", merchant: "Shopify" },
  { pattern: "gusto", category: "payroll", priority: 145, appliesTo: "debit", merchant: "Gusto" },
  { pattern: "adp payroll", category: "payroll", priority: 145, appliesTo: "debit", merchant: "ADP" },

  // Software and infrastructure — the one place a small business's spending is
  // predictable enough to ship rules for.
  { pattern: "amazon web services", category: "biz-software", merchant: "AWS" },
  { pattern: "aws", category: "biz-software", merchant: "AWS" },
  { pattern: "google cloud", category: "biz-software", merchant: "Google Cloud" },
  { pattern: "digitalocean", category: "biz-software", merchant: "DigitalOcean" },
  { pattern: "vercel", category: "biz-software", merchant: "Vercel" },
  { pattern: "cloudflare", category: "biz-software", merchant: "Cloudflare" },
  { pattern: "github", category: "biz-software", merchant: "GitHub" },
  { pattern: "atlassian", category: "biz-software", merchant: "Atlassian" },
  { pattern: "slack", category: "biz-software", merchant: "Slack" },
  { pattern: "notion", category: "biz-software", merchant: "Notion" },
  { pattern: "figma", category: "biz-software", merchant: "Figma" },
  { pattern: "adobe", category: "biz-software", merchant: "Adobe" },
  { pattern: "openai", category: "biz-software", merchant: "OpenAI" },
  { pattern: "anthropic", category: "biz-software", merchant: "Anthropic" },
  { pattern: "twilio", category: "biz-software", merchant: "Twilio" },
  { pattern: "namecheap", category: "biz-software", merchant: "Namecheap" },
  { pattern: "godaddy", category: "biz-software", merchant: "GoDaddy" },
  { pattern: "quickbooks", category: "professional-services", merchant: "QuickBooks" },
  { pattern: "intuit", category: "professional-services", merchant: "Intuit" },

  // Marketing
  { pattern: "google ads", category: "marketing", merchant: "Google Ads" },
  { pattern: "meta platforms", category: "marketing", merchant: "Meta Ads" },
  { pattern: "facebook ads", category: "marketing", merchant: "Meta Ads" },
  { pattern: "linkedin", category: "marketing", merchant: "LinkedIn" },
  { pattern: "mailchimp", category: "marketing", merchant: "Mailchimp" },

  // Shipping and supplies
  { pattern: "usps", category: "biz-supplies", merchant: "USPS" },
  { pattern: "fedex", category: "biz-supplies", merchant: "FedEx" },
  { pattern: "ups store", category: "biz-supplies", merchant: "UPS" },
  { pattern: "staples", category: "biz-supplies", merchant: "Staples" },
  { pattern: "office depot", category: "biz-supplies", merchant: "Office Depot" },

  /*
   * Payment rails, same treatment as the personal ledger: charged as an
   * expense so an unanswered question never reduces the period's costs, and
   * queued because only the owner knows whether a Zelle was a subcontractor,
   * a refund or their own draw. That last possibility is why these must not
   * default to a deductible category.
   */
  { pattern: "zelle", category: BUSINESS_UNCATEGORIZED, priority: 138, appliesTo: "debit", merchant: "Zelle", queueForReview: true },
  { pattern: "venmo", category: BUSINESS_UNCATEGORIZED, priority: 138, appliesTo: "debit", merchant: "Venmo", queueForReview: true },
  { pattern: "cash app", category: BUSINESS_UNCATEGORIZED, priority: 138, appliesTo: "debit", merchant: "Cash App", queueForReview: true },
];

/** Every business rule belongs to the business chart of accounts. */
export const BUSINESS_SEED_RULES: SeedRule[] = BUSINESS_RULES_RAW.map((r) => ({
  ...r,
  mode: "business" as const,
}));
