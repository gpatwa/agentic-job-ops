import type { JobSource } from "../models/domain";

/**
 * Curated catalog of well-known engineering employers whose
 * public ATS boards we can ingest from. Each entry is tagged with
 * the industries and role families the company hires across so
 * the LLM-driven discovery service (companyJobDiscovery.ts) can
 * pick the right subset based on the candidate's resume — instead
 * of forcing a customer to manually configure ATS sources.
 *
 * Slugs were verified against the live Greenhouse / Lever public
 * boards on the day this catalog was last touched. Boards that
 * returned 0 jobs (probably moved off the ATS) are intentionally
 * omitted; they can be re-added once the slug is rechecked.
 *
 * Adding a new entry:
 *   1. curl https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=false
 *      and confirm it returns >0 jobs.
 *   2. Tag the entry with the industries + roleFamilies the
 *      company actually hires for. The LLM matches `recommendation
 *      .recommendedIndustries` against `industries` (case-
 *      insensitive substring) and `recommendation.strongestRoles[]
 *      .title` against `roleFamilies` to decide whether to
 *      include the company for a given resume.
 */

export interface CuratedCompany {
  /** ATS board slug, e.g. "anthropic" for boards-api.greenhouse.io/v1/boards/anthropic. */
  slug: string;
  /** ATS family. Drives which connector runs the ingestion. */
  source: Extract<JobSource, "greenhouse" | "lever">;
  /** Human-readable name for display + audit. */
  displayName: string;
  /**
   * Industries the company hires for. Matched (case-insensitive
   * substring, both directions) against
   * `recommendation.recommendedIndustries` from the resume LLM.
   */
  industries: string[];
  /**
   * Role families the company has openings in. Matched (case-
   * insensitive substring) against the LLM's recommended role
   * titles + recommendedSearchKeywords.
   */
  roleFamilies: string[];
}

export const CURATED_COMPANY_CATALOG: CuratedCompany[] = [
  {
    slug: "anthropic",
    source: "greenhouse",
    displayName: "Anthropic",
    industries: [
      "AI",
      "Artificial Intelligence",
      "B2B SaaS",
      "Developer infrastructure",
      "Research",
      "Enterprise Software"
    ],
    roleFamilies: [
      "AI",
      "Machine Learning",
      "Engineering",
      "Research",
      "Product",
      "Data",
      "Security"
    ]
  },
  {
    slug: "stripe",
    source: "greenhouse",
    displayName: "Stripe",
    industries: [
      "Fintech",
      "B2B SaaS",
      "Payments",
      "Developer infrastructure",
      "Enterprise Software"
    ],
    roleFamilies: [
      "Engineering",
      "Product",
      "Design",
      "Data",
      "Sales",
      "Operations"
    ]
  },
  {
    slug: "airbnb",
    source: "greenhouse",
    displayName: "Airbnb",
    industries: [
      "Marketplace",
      "Consumer",
      "Travel",
      "B2C SaaS"
    ],
    roleFamilies: [
      "Engineering",
      "Product",
      "Design",
      "Data",
      "Operations"
    ]
  },
  {
    slug: "pinterest",
    source: "greenhouse",
    displayName: "Pinterest",
    industries: [
      "Consumer",
      "Social",
      "Search and Discovery",
      "Advertising"
    ],
    roleFamilies: [
      "Engineering",
      "Product",
      "Design",
      "Data",
      "Machine Learning"
    ]
  },
  {
    slug: "discord",
    source: "greenhouse",
    displayName: "Discord",
    industries: [
      "Consumer",
      "Gaming",
      "Communications",
      "Communities"
    ],
    roleFamilies: ["Engineering", "Product", "Design", "Data"]
  },
  {
    slug: "coinbase",
    source: "greenhouse",
    displayName: "Coinbase",
    industries: [
      "Fintech",
      "Crypto",
      "B2C SaaS",
      "Trading"
    ],
    roleFamilies: ["Engineering", "Product", "Data", "Security"]
  },
  {
    slug: "robinhood",
    source: "greenhouse",
    displayName: "Robinhood",
    industries: ["Fintech", "B2C SaaS", "Trading", "Investing"],
    roleFamilies: ["Engineering", "Product", "Data", "Design"]
  },
  {
    slug: "figma",
    source: "greenhouse",
    displayName: "Figma",
    industries: [
      "Design Tools",
      "B2B SaaS",
      "Developer infrastructure",
      "Productivity"
    ],
    roleFamilies: ["Engineering", "Product", "Design"]
  },
  {
    slug: "gitlab",
    source: "greenhouse",
    displayName: "GitLab",
    industries: [
      "Developer infrastructure",
      "B2B SaaS",
      "DevOps",
      "Open Source"
    ],
    roleFamilies: ["Engineering", "Product", "Sales", "Security"]
  }
];

/**
 * Pure-function discovery: pick the curated companies whose
 * industry / role-family tags overlap with the LLM's resume
 * recommendation. Case-insensitive bi-directional substring
 * match — so "Developer infrastructure" on a tag matches
 * "developer tools" or "infrastructure" coming from the LLM.
 */
export function pickCuratedCompaniesForResume(input: {
  industries: string[];
  roleTitles: string[];
  searchKeywords: string[];
}): CuratedCompany[] {
  const haystack = [
    ...input.industries,
    ...input.roleTitles,
    ...input.searchKeywords
  ]
    .map((value) => value.toLowerCase())
    .filter((value) => value.length > 0);
  if (haystack.length === 0) return [];

  return CURATED_COMPANY_CATALOG.filter((company) => {
    const tags = [...company.industries, ...company.roleFamilies].map((tag) =>
      tag.toLowerCase()
    );
    return tags.some((tag) =>
      haystack.some(
        (needle) =>
          tag.includes(needle) || needle.includes(tag)
      )
    );
  });
}
