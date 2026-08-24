/**
 * Article/NewsArticle/Recipe/Dataset structured data for story pages -- see
 * NEEDS-HUMAN-REVIEW.md "4.2 Structured data". Pulled into its own module
 * for the same reason as event-jsonld.ts: testable independent of Astro's
 * build pipeline (see article-jsonld.test.ts).
 *
 * TYPE CHOICE MATTERS, NOT JUST FORMAT: the previous version of this block
 * emitted a bare `NewsArticle` for every story regardless of type, which
 * overclaims for opinion/review/essay content the same way the old Event
 * block overclaimed a town-level address for every event -- NewsArticle
 * specifically signals factual news reporting; an editorial or a review
 * isn't that, and schema.org has more accurate subtypes for exactly this
 * ("attribute, don't assert" applies to structured data too, not just body
 * copy). Authorship disclosure is preserved everywhere (Organization
 * author, never a fabricated Person) -- the honesty about AI authorship IS
 * the trust signal, not something to hide to look more human.
 */
import { formatPrice, type SourceType, type Story, type PropertySale } from './db';

const ARTICLE_TYPE_BY_SOURCE_TYPE: Partial<Record<SourceType, string>> = {
  editorial: 'OpinionNewsArticle',
  media_recension: 'ReviewNewsArticle',
  culture_essay: 'Article',
  kvick_essa: 'Article',
  vetenskap_kronika: 'Article',
  vardagsmiddag: 'Article',
};

function articleType(sourceType: SourceType): string {
  return ARTICLE_TYPE_BY_SOURCE_TYPE[sourceType] ?? 'NewsArticle';
}

export function buildArticleJsonLd(
  story: Pick<Story, 'title' | 'published_at' | 'body' | 'source_type' | 'rating'>,
  heroUrl: string,
  siteName: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': articleType(story.source_type),
    headline: story.title,
    datePublished: story.published_at,
    dateModified: story.published_at,
    articleBody: story.body,
    image: [heroUrl],
    // story.byline is always the literal string "AI-genererad" (see
    // content/_base.py:to_metadata) -- a transparency marker, not a real
    // name. Setting '@type':'Person', name:'AI-genererad' would claim a
    // person by that name wrote the text, exactly the kind of invented
    // fact this project's own rules otherwise never allow. No story has a
    // real human author today, so Organization applies to all of them.
    author: { '@type': 'Organization', name: siteName },
    publisher: { '@type': 'Organization', name: siteName },
  };

  // ReviewNewsArticle can carry a structured reviewRating -- only added
  // when a real numeric rating was actually extracted (see
  // content/recensioner/media_recension.py), never synthesized.
  if (story.source_type === 'media_recension' && story.rating != null) {
    base.reviewRating = {
      '@type': 'Rating',
      ratingValue: story.rating,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return base;
}

export interface RecipeStory {
  title: string;
  body: string;
  published_at: string;
  ingredients: string[] | null;
  instructions: string[] | null;
}

/**
 * Additional Recipe markup, alongside (not instead of) the Article block
 * above -- only emitted when structured ingredients/instructions actually
 * extracted (see content/recept/vardagsmiddag.py's fail-loud gate: a
 * vardagsmiddag story only ever gets published WITH both, so this is
 * really "always, for a real recipe," but checked explicitly rather than
 * assumed).
 */
export function buildRecipeJsonLd(story: RecipeStory, heroUrl: string, siteName: string): Record<string, unknown> | null {
  if (!story.ingredients?.length || !story.instructions?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: story.title,
    image: [heroUrl],
    datePublished: story.published_at,
    author: { '@type': 'Organization', name: siteName },
    recipeIngredient: story.ingredients,
    recipeInstructions: story.instructions.map((step) => ({ '@type': 'HowToStep', text: step })),
  };
}

export interface HomeSalesDigestStory {
  title: string;
  body: string;
  // The Neon driver returns a TIMESTAMPTZ column as either a string or an
  // already-parsed Date depending on context (same caveat db.ts's own
  // calendarDateParts() already handles for occurs_at elsewhere) -- accept
  // both rather than assuming one.
  occurs_at: string | Date | null;
  published_at: string;
}

/**
 * Additional Dataset markup for home-sales digests -- these summarize a
 * real, queryable dataset (property_sales, see ai_pipeline/
 * home_sales_digest.py), which Dataset is the more accurate schema.org type
 * for alongside the Article block a reader-facing digest also legitimately
 * is. No distribution/DataDownload claimed -- there's no downloadable file,
 * just the /home-sales/ table page, which url already points to.
 */
export function buildDatasetJsonLd(
  story: HomeSalesDigestStory, canonicalUrl: string, cityName: string, siteName: string,
): Record<string, unknown> | null {
  if (!story.occurs_at) return null;
  const iso = story.occurs_at instanceof Date ? story.occurs_at.toISOString() : story.occurs_at;
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: story.title,
    description: story.body.slice(0, 300),
    url: canonicalUrl,
    temporalCoverage: iso.slice(0, 7), // YYYY-MM
    spatialCoverage: { '@type': 'Place', name: cityName },
    creator: { '@type': 'Organization', name: siteName },
    isAccessibleForFree: true,
  };
}

/**
 * A home-sales permalink page (see NEEDS-HUMAN-REVIEW.md, "Week 4 -- Home
 * Sales Address Pages"). `Place`, not an active-listing type -- this is a
 * public record of what a property has sold for, never a for-sale
 * advertisement, and schema.org's real-estate-listing vocabulary is for
 * the latter. Each recorded sale becomes a PropertyValue fact rather than
 * a fabricated event/offer type with no clean schema.org fit; `sales` must
 * already be sorted (most recent first) by the caller, same "this function
 * doesn't second-guess its input" contract as buildEventJsonLd.
 */
export function buildPropertySaleJsonLd(
  address: string,
  sales: Pick<PropertySale, 'sale_price' | 'sale_date'>[],
  canonicalUrl: string,
  cityName: string,
  stateAbbr: string,
  zip: string,
): Record<string, unknown> | null {
  if (sales.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    '@id': canonicalUrl,
    url: canonicalUrl,
    name: address,
    address: {
      '@type': 'PostalAddress',
      streetAddress: address.split(',')[0]?.trim() || address,
      addressLocality: cityName,
      addressRegion: stateAbbr,
      ...(zip ? { postalCode: zip } : {}),
      addressCountry: 'US',
    },
    additionalProperty: sales.map((s) => ({
      '@type': 'PropertyValue',
      name: 'Recorded sale',
      value: s.sale_price != null ? formatPrice(s.sale_price) : 'Price not recorded',
      description: s.sale_date ?? undefined,
    })),
  };
}
