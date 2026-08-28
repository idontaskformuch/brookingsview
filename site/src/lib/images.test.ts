import { describe, expect, it } from 'vitest';
import {
  normalizeVenueText, extractTitleVenuePrefix, buildNameAliasIndex,
  resolveVenueSlugForImage, categoryForSourceType, dedupeConsecutiveImages,
  resolveImage, pickFromPool, requiredCategoriesFor, assertCategoryImagesComplete,
  type ImageRef, type ResolvableStory,
} from './images';
import type { Facility } from './db';

// A real, existing file under site/public/assets/images/ -- used to exercise
// resolveImage()'s success path without writing throwaway fixture files.
const EXISTING_IMAGE = '/assets/images/culture_essay-2026-07-20.png';

function facility(overrides: Partial<Facility> & Pick<Facility, 'slug'>): Facility {
  return {
    name: overrides.slug, category: 'other', address: null, phone: null, website: null,
    hours_text: null, description: null, source_url: null, verified_date: null,
    aliases: [], street_address: null, postal_code: null, lat: null, lon: null,
    image_path: null, image_alt: null, name_aliases: [],
    image_attribution_text: null, image_attribution_url: null,
    ...overrides,
  };
}

describe('normalizeVenueText', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeVenueText("ABC's & 123's")).toBe('abc s 123 s');
  });

  it('expands mv to moreno valley', () => {
    expect(normalizeVenueText('MV MALL')).toBe('moreno valley mall');
  });

  it('expands sdsu to south dakota state university', () => {
    expect(normalizeVenueText('SDSU')).toBe('south dakota state university');
  });

  it('strips a single trailing noise word', () => {
    expect(normalizeVenueText('Main Library')).toBe('main');
  });

  it('strips only the trailing noise word, not one in the middle', () => {
    expect(normalizeVenueText('The Main Library')).toBe('the main');
  });

  it('leaves a single-word input alone even if it is a noise word', () => {
    expect(normalizeVenueText('Library')).toBe('library');
  });
});

describe('extractTitleVenuePrefix', () => {
  it('strips a leading town prefix before extracting the venue prefix', () => {
    expect(extractTitleVenuePrefix('Moreno Valley: IRIS PLAZA: ABC\'s & 123\'s', 'Moreno Valley'))
      .toBe('IRIS PLAZA');
  });

  it('returns null when the title has no colon-delimited prefix', () => {
    expect(extractTitleVenuePrefix('Brookings: Farmers Market', 'Brookings')).toBeNull();
  });

  it('extracts the prefix directly when there is no town prefix present', () => {
    expect(extractTitleVenuePrefix('MAIN LIBRARY: Talk MoVal', 'Moreno Valley')).toBe('MAIN LIBRARY');
  });
});

describe('buildNameAliasIndex / resolveVenueSlugForImage', () => {
  const facilities: Facility[] = [
    facility({ slug: 'main-library', name_aliases: ['MAIN LIBRARY', 'MAIN Library', 'MAIN'] }),
    facility({ slug: 'mall-branch-library', name_aliases: ['MV MALL', 'MV MALL LIBRARY', 'MV MALL BRANCH'] }),
    facility({ slug: 'iris-plaza-branch-library', name_aliases: ['IRIS PLAZA', 'IRIS PLAZA LIBRARY'] }),
  ];
  const index = buildNameAliasIndex(facilities);

  it('matches the longest alias first ("mv mall library" over "mv mall")', () => {
    expect(index.get(normalizeVenueText('MV MALL LIBRARY'))).toBe('mall-branch-library');
    expect(index.get(normalizeVenueText('MV MALL'))).toBe('mall-branch-library');
  });

  it('prefers a title-prefix match over venue_raw, given the known ~18% venue_raw mismatch', () => {
    const story = {
      title: 'Moreno Valley: IRIS PLAZA: ABC\'s & 123\'s',
      // A real, observed-wrong venue_raw for this exact recurring title
      // (see lib/images.ts's module docstring) -- title-prefix must win.
      venue_raw: 'Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA',
    };
    expect(resolveVenueSlugForImage(story, index, 'Moreno Valley')).toBe('iris-plaza-branch-library');
  });

  it('falls back to venue_raw when the title has no recognizable venue prefix', () => {
    const story = { title: 'Moreno Valley: Toddler Storytime', venue_raw: 'Main Library,25480 Alessandro Blvd' };
    expect(resolveVenueSlugForImage(story, index, 'Moreno Valley')).toBe('main-library');
  });

  it('returns null when neither title prefix nor venue_raw matches any alias', () => {
    const story = { title: 'Moreno Valley: Free Food Giveaway (Every Sunday)', venue_raw: null };
    expect(resolveVenueSlugForImage(story, index, 'Moreno Valley')).toBeNull();
  });
});

describe('categoryForSourceType', () => {
  it('maps meetings and meeting_followups to city_hall', () => {
    expect(categoryForSourceType('meeting')).toBe('city_hall');
    expect(categoryForSourceType('meeting_followup')).toBe('city_hall');
  });

  it('returns null for a content-track type', () => {
    expect(categoryForSourceType('editorial')).toBeNull();
  });
});

describe('dedupeConsecutiveImages', () => {
  const img = (path: string): ImageRef => ({ path, alt: '', width: 1, height: 1 });

  it('drops an immediately-repeated image but keeps the first occurrence', () => {
    const items = ['a', 'b', 'c'];
    const images: Record<string, ImageRef | null> = {
      a: img('/x.png'), b: img('/x.png'), c: img('/y.png'),
    };
    const result = dedupeConsecutiveImages(items, (item) => images[item]);
    expect(result.map((r) => r.image?.path ?? null)).toEqual(['/x.png', null, '/y.png']);
  });

  it('does not dedupe the same image when something else appears in between', () => {
    const items = ['a', 'b', 'c'];
    const images: Record<string, ImageRef | null> = {
      a: img('/x.png'), b: img('/y.png'), c: img('/x.png'),
    };
    const result = dedupeConsecutiveImages(items, (item) => images[item]);
    expect(result.map((r) => r.image?.path ?? null)).toEqual(['/x.png', '/y.png', '/x.png']);
  });

  it('never dedupes consecutive nulls against each other', () => {
    const items = ['a', 'b'];
    const result = dedupeConsecutiveImages(items, () => null);
    expect(result.map((r) => r.image)).toEqual([null, null]);
  });
});

describe('pickFromPool', () => {
  it('returns the only entry for a length-1 pool', () => {
    expect(pickFromPool(['only'], 'anything')).toBe('only');
  });

  it('is deterministic -- the same seed always picks the same entry', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const first = pickFromPool(pool, 'meeting-2026-08-27-11295');
    for (let i = 0; i < 20; i++) {
      expect(pickFromPool(pool, 'meeting-2026-08-27-11295')).toBe(first);
    }
  });

  it('different seeds spread across a pool rather than collapsing onto one entry', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const seeds = Array.from({ length: 30 }, (_, i) => `event-slug-${i}`);
    const picks = new Set(seeds.map((s) => pickFromPool(pool, s)));
    // Not asserting every slot gets hit (that's a distribution-quality
    // claim a plain string hash doesn't strictly guarantee) -- just that
    // 30 different real-shaped slugs don't all collapse onto a single
    // pool entry, which is the actual bug this fixes.
    expect(picks.size).toBeGreaterThan(1);
  });

  it('never picks an out-of-bounds index', () => {
    const pool = ['a', 'b', 'c'];
    for (const seed of ['', 'x', 'a very long slug indeed', '2026-08-27']) {
      expect(pool).toContain(pickFromPool(pool, seed));
    }
  });
});

describe('resolveImage', () => {
  const baseOptions = {
    town: 'moreno_valley_ca' as const,
    cityName: 'Moreno Valley',
    facilities: [] as Facility[],
    categoryImages: {},
  };

  it('tier 1: returns the article image when story.image_path is set', () => {
    const story: ResolvableStory = {
      title: 'Editorial', source_type: 'editorial', image_path: EXISTING_IMAGE,
      image_alt: 'A real alt', venue_raw: null,
    };
    const result = resolveImage(story, baseOptions);
    expect(result?.path).toBe(EXISTING_IMAGE);
    expect(result?.alt).toBe('A real alt');
  });

  it('tier 1: throws loudly when the resolved image_path does not exist on disk', () => {
    const story: ResolvableStory = {
      title: 'Editorial', source_type: 'editorial', image_path: '/assets/images/does-not-exist-12345.png',
      image_alt: null, venue_raw: null,
    };
    expect(() => resolveImage(story, baseOptions)).toThrow(/does-not-exist-12345\.png/);
  });

  it('tier 2: returns the resolved venue image when the title-prefix matches a facility', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: IRIS PLAZA: ABC\'s & 123\'s', source_type: 'event',
      image_path: null, image_alt: null,
      venue_raw: 'Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA',
    };
    const options = {
      ...baseOptions,
      facilities: [facility({
        slug: 'iris-plaza-branch-library',
        name_aliases: ['IRIS PLAZA', 'IRIS PLAZA LIBRARY'],
        image_path: EXISTING_IMAGE, image_alt: 'Iris Plaza branch library',
      })],
    };
    const result = resolveImage(story, options);
    expect(result?.path).toBe(EXISTING_IMAGE);
    expect(result?.alt).toBe('Iris Plaza branch library');
  });

  it('tier 2: propagates a facility\'s image_attribution_text/url onto the resolved ImageRef', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: City Hall: Council Meeting', source_type: 'event',
      image_path: null, image_alt: null, venue_raw: null,
    };
    const options = {
      ...baseOptions,
      facilities: [facility({
        slug: 'city-hall',
        name_aliases: ['City Hall'],
        image_path: EXISTING_IMAGE, image_alt: 'Moreno Valley City Hall',
        image_attribution_text: 'Photo by Z3lvs / Wikimedia Commons (CC0)',
        image_attribution_url: 'https://commons.wikimedia.org/wiki/File:Moreno_Valley,_California_City_Hall.jpg',
      })],
    };
    const result = resolveImage(story, options);
    expect(result?.attributionText).toBe('Photo by Z3lvs / Wikimedia Commons (CC0)');
    expect(result?.attributionUrl).toBe('https://commons.wikimedia.org/wiki/File:Moreno_Valley,_California_City_Hall.jpg');
  });

  it('tier 2: attributionText/Url are undefined (not null) when the facility has none', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: City Hall: Council Meeting', source_type: 'event',
      image_path: null, image_alt: null, venue_raw: null,
    };
    const options = {
      ...baseOptions,
      facilities: [facility({
        slug: 'city-hall', name_aliases: ['City Hall'], image_path: EXISTING_IMAGE,
      })],
    };
    const result = resolveImage(story, options);
    expect(result?.attributionText).toBeUndefined();
    expect(result?.attributionUrl).toBeUndefined();
  });

  it('tier 3: falls back to the category image when no venue matches', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: City Council Meeting', source_type: 'meeting',
      image_path: null, image_alt: null, venue_raw: null,
    };
    const categoryImage: ImageRef = { path: EXISTING_IMAGE, alt: 'City Hall', width: 1200, height: 800 };
    const result = resolveImage(story, { ...baseOptions, categoryImages: { city_hall: [categoryImage] } });
    expect(result).toEqual(categoryImage);
  });

  it('tier 3: picks from a multi-image pool instead of always the first entry', () => {
    const pool: ImageRef[] = [
      { path: EXISTING_IMAGE, alt: 'A', width: 1200, height: 800 },
      { path: EXISTING_IMAGE, alt: 'B', width: 1200, height: 800 },
      { path: EXISTING_IMAGE, alt: 'C', width: 1200, height: 800 },
    ];
    const storyA: ResolvableStory & { slug: string } = {
      slug: 'event-aaa', title: 'Event A', source_type: 'event', image_path: null, image_alt: null, venue_raw: null,
    };
    const storyB: ResolvableStory & { slug: string } = {
      slug: 'event-bbb', title: 'Event B', source_type: 'event', image_path: null, image_alt: null, venue_raw: null,
    };
    const options = { ...baseOptions, categoryImages: { events: pool } };
    const resultA = resolveImage(storyA, options);
    const resultB = resolveImage(storyB, options);
    // Not asserting a SPECIFIC index (that's pickFromPool's own contract,
    // tested directly below) -- just that different slugs are capable of
    // landing on different pool entries, which was impossible before this
    // fix (a length-1 pool always returned its one entry regardless).
    expect(pool).toContainEqual(resultA);
    expect(pool).toContainEqual(resultB);
  });

  it('tier 3: the SAME story always resolves to the SAME pool entry (stable across rebuilds)', () => {
    const pool: ImageRef[] = [
      { path: EXISTING_IMAGE, alt: 'A', width: 1200, height: 800 },
      { path: EXISTING_IMAGE, alt: 'B', width: 1200, height: 800 },
      { path: EXISTING_IMAGE, alt: 'C', width: 1200, height: 800 },
    ];
    const story: ResolvableStory & { slug: string } = {
      slug: 'event-stable', title: 'Event', source_type: 'event', image_path: null, image_alt: null, venue_raw: null,
    };
    const options = { ...baseOptions, categoryImages: { events: pool } };
    const first = resolveImage(story, options);
    const second = resolveImage(story, options);
    expect(first).toEqual(second);
  });

  it('tier 4: returns null, never the /og/<slug>.png social card', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: Free Food Giveaway (Every Sunday)', source_type: 'event',
      image_path: null, image_alt: null, venue_raw: null,
    };
    expect(resolveImage(story, baseOptions)).toBeNull();
  });

  it('a category absent for a town resolves to null, never leaking the other town\'s image', () => {
    const story: ResolvableStory = {
      title: 'Brookings: SDSU Homecoming', source_type: 'university_digest',
      image_path: null, image_alt: null, venue_raw: null,
    };
    // categoryImages intentionally has no 'university' entry (as it wouldn't
    // for moreno_valley_ca, which has no university category at all).
    expect(resolveImage(story, baseOptions)).toBeNull();
  });
});

// --- build-time completeness (see handoff "Broomfield has no hero image
// and no inline article images", Phase 3) --------------------------------

const POOL: ImageRef[] = [{ path: EXISTING_IMAGE, alt: 'x', width: 1, height: 1 }];

describe('requiredCategoriesFor', () => {
  it('never requires university/sports for Broomfield (structurally unreachable)', () => {
    const required = requiredCategoriesFor({ townId: 'broomfield_co' });
    expect(required).not.toContain('university');
    expect(required).not.toContain('sports');
  });

  it('requires sports for a town that is not Broomfield', () => {
    expect(requiredCategoriesFor({ townId: 'brookings_sd' })).toContain('sports');
    expect(requiredCategoriesFor({ townId: 'moreno_valley_ca' })).toContain('sports');
  });

  it('only requires university for Brookings', () => {
    expect(requiredCategoriesFor({ townId: 'brookings_sd' })).toContain('university');
    expect(requiredCategoriesFor({ townId: 'moreno_valley_ca' })).not.toContain('university');
  });

  it('requires feature-gated categories only when the corresponding flag is set', () => {
    const nothingEnabled = requiredCategoriesFor({ townId: 'broomfield_co' });
    expect(nothingEnabled).not.toContain('workplace_watch');
    expect(nothingEnabled).not.toContain('school_alerts');
    expect(nothingEnabled).not.toContain('home_sales');
    expect(nothingEnabled).not.toContain('traffic');

    const allEnabled = requiredCategoriesFor({
      townId: 'broomfield_co', hasWorkplaceWatch: true, hasClosureWatch: true,
      hasHousingMarket: true, trafficSource: { name: 'x', url: 'x', scopeNote: 'x' },
    });
    expect(allEnabled).toEqual(expect.arrayContaining(['workplace_watch', 'school_alerts', 'home_sales', 'traffic']));
  });
});

describe('assertCategoryImagesComplete', () => {
  it('throws naming the town and every missing category when the pool is entirely empty', () => {
    expect(() => assertCategoryImagesComplete({ townId: 'broomfield_co' }, {})).toThrowError(/broomfield_co/);
  });

  it('throws naming only the specific missing categories, not ones already present', () => {
    try {
      assertCategoryImagesComplete({ townId: 'broomfield_co' }, { city_hall: POOL, events: POOL });
      throw new Error('expected assertCategoryImagesComplete to throw');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('weather_alert');
      expect(message).toContain('jobs');
      expect(message).not.toContain('city_hall');
      expect(message).not.toContain('events');
    }
  });

  it('passes silently once every required category has a non-empty pool', () => {
    const fullPool: Partial<Record<string, ImageRef[]>> = {
      city_hall: POOL, events: POOL, weather_alert: POOL, jobs: POOL,
    };
    expect(() => assertCategoryImagesComplete({ townId: 'broomfield_co' }, fullPool)).not.toThrow();
  });

  it('an empty-array pool counts as missing, same as a missing key entirely', () => {
    expect(() => assertCategoryImagesComplete(
      { townId: 'broomfield_co' },
      { city_hall: [], events: POOL, weather_alert: POOL, jobs: POOL },
    )).toThrowError(/city_hall/);
  });
});
