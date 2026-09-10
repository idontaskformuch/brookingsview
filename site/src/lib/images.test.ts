import { describe, expect, it } from 'vitest';
import {
  normalizeVenueText, extractTitleVenuePrefix, buildNameAliasIndex,
  resolveVenueSlugForImage, categoryForSourceType, dedupeConsecutiveImages,
  resolveImage, pickFromPool, pickFromPoolByIndex, requiredCategoriesFor, assertCategoryImagesComplete,
  findContentTrackRowsMissingImage, withThumbnailCrop, contentTrackCropPaths,
  previousWeekRoundupImagePath,
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
    image_attribution_text: null, image_attribution_url: null, image_needs_review: false,
    free_teaser: null, hours_structured: null, hours_needs_review: false,
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

  it('maps media_recension to movie_review (TMDB/pool handoff)', () => {
    expect(categoryForSourceType('media_recension')).toBe('movie_review');
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

  describe('with exclude (image-rotation Part 2/3: within-page and across-time variety)', () => {
    it('behaves exactly as before when exclude is omitted or empty', () => {
      const pool = ['a', 'b', 'c'];
      const withoutExclude = pickFromPool(pool, 'seed-1');
      expect(pickFromPool(pool, 'seed-1', { exclude: new Set() })).toBe(withoutExclude);
      expect(pickFromPool(pool, 'seed-1', {})).toBe(withoutExclude);
    });

    it('picks an alternative pool entry when the canonical pick is excluded', () => {
      const pool = ['a', 'b', 'c'];
      const canonical = pickFromPool(pool, 'seed-1');
      const alternative = pickFromPool(pool, 'seed-1', { exclude: new Set([canonical]) });
      expect(alternative).not.toBe(canonical);
      expect(pool).toContain(alternative);
    });

    it('degrades to the canonical pick when every pool entry is already excluded (pool smaller than items needing one)', () => {
      const pool = ['a', 'b', 'c'];
      const canonical = pickFromPool(pool, 'seed-1');
      const stillCanonical = pickFromPool(pool, 'seed-1', { exclude: new Set(pool) });
      expect(stillCanonical).toBe(canonical);
    });

    it('a length-1 pool always returns its one entry regardless of exclude', () => {
      expect(pickFromPool(['only'], 'seed-1', { exclude: new Set(['only']) })).toBe('only');
    });

    it('with a 2-entry pool, excluding the canonical pick deterministically alternates to the other one -- not a real "avoid history", just an alternation, honestly (see the weekly-roundup exclude comment in pages/index.astro)', () => {
      const pool = ['a', 'b'];
      const canonical = pickFromPool(pool, 'seed-1');
      const other = pool.find((p) => p !== canonical)!;
      expect(pickFromPool(pool, 'seed-1', { exclude: new Set([canonical]) })).toBe(other);
    });

    it('sequentially excluding each prior pick spreads consecutive items across the pool instead of collapsing onto the same bucket', () => {
      // Simulates index.astro's own within-page threading: each item's pick
      // is added to `exclude` before resolving the next one.
      const pool = ['a', 'b', 'c'];
      const seeds = ['weekly-2026-w35', 'today-read-2026-08-27', 'meeting-2026-08-27-1'];
      const exclude = new Set<string>();
      const picks: string[] = [];
      for (const seed of seeds) {
        const pick = pickFromPool(pool, seed, { exclude });
        picks.push(pick);
        exclude.add(pick);
      }
      // With a 3-item pool and 3 items, every pick should be distinct --
      // this is exactly the case (WeeklyRoundup + Today's read + a lead
      // meeting card, all category 'events'/'city_hall') the real bug
      // report was about.
      expect(new Set(picks).size).toBe(3);
    });

    it('respects a custom getKey for pools of objects (not bare strings)', () => {
      const pool = [{ path: '/a.png' }, { path: '/b.png' }, { path: '/c.png' }];
      const canonical = pickFromPool(pool, 'seed-1', { getKey: (i) => i.path });
      const alternative = pickFromPool(pool, 'seed-1', {
        exclude: new Set([canonical.path]),
        getKey: (i) => i.path,
      });
      expect(alternative.path).not.toBe(canonical.path);
    });
  });
});

describe('pickFromPoolByIndex (image pool rotation, Addendum 2)', () => {
  it('picks the exact slot for an in-range index', () => {
    const pool = ['a', 'b', 'c'];
    expect(pickFromPoolByIndex(pool, 0)).toBe('a');
    expect(pickFromPoolByIndex(pool, 1)).toBe('b');
    expect(pickFromPoolByIndex(pool, 2)).toBe('c');
  });

  it('wraps via modulo for an index at or beyond the pool length -- a pool that shrank since assignment', () => {
    const pool = ['a', 'b', 'c'];
    expect(pickFromPoolByIndex(pool, 3)).toBe('a');
    expect(pickFromPoolByIndex(pool, 4)).toBe('b');
    expect(pickFromPoolByIndex(pool, 100)).toBe(pool[100 % 3]);
  });

  it('successive indices visit the pool in strict round-robin order -- the actual point of this over a hash', () => {
    const pool = ['a', 'b', 'c'];
    const visited = [0, 1, 2, 3, 4, 5].map((i) => pickFromPoolByIndex(pool, i));
    expect(visited).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('respects exclude the same way pickFromPool does', () => {
    const pool = ['a', 'b', 'c'];
    expect(pickFromPoolByIndex(pool, 0, { exclude: new Set(['a']) })).toBe('b');
  });

  it('a length-1 pool always returns its one entry regardless of index', () => {
    expect(pickFromPoolByIndex(['only'], 47)).toBe('only');
  });
});

describe('previousWeekRoundupImagePath (image-rotation Part 3, across-time variety)', () => {
  const pool: ImageRef[] = [
    { path: '/a.png', alt: 'A', width: 1, height: 1 },
    { path: '/b.png', alt: 'B', width: 1, height: 1 },
    { path: '/c.png', alt: 'C', width: 1, height: 1 },
  ];

  // Real ai_pipeline/weekly.py output: LOCAL midnight Monday in the town's
  // own timezone, stored as a timestamptz -- '2026-09-07T05:00:00Z' is
  // exactly 2026-09-07 00:00 America/Chicago (CDT, UTC-5). A naive literal
  // like '2026-09-07T00:00:00Z' would be 2026-09-06 19:00 LOCAL (still
  // Sunday) and silently test the wrong week -- caught by an earlier
  // version of this test actually failing against that literal.
  const MONDAY_2026_W37_UTC = '2026-09-07T05:00:00Z';
  const MONDAY_2027_W01_UTC = '2027-01-04T06:00:00Z'; // CST, UTC-6, by January

  it('returns null for a pool of 0 or 1 entries -- nothing meaningful to exclude', () => {
    expect(previousWeekRoundupImagePath([], MONDAY_2026_W37_UTC, 'America/Chicago')).toBeNull();
    expect(previousWeekRoundupImagePath([pool[0]], MONDAY_2026_W37_UTC, 'America/Chicago')).toBeNull();
  });

  it("matches pickFromPool() run directly against last week's own slug", () => {
    // ISO week 37, 2026 -> previous is ISO week 36 of the same year.
    const result = previousWeekRoundupImagePath(pool, MONDAY_2026_W37_UTC, 'America/Chicago');
    expect(result).toBe(pickFromPool(pool, 'weekly-2026-w36').path);
  });

  it("correctly crosses a year boundary (ISO week 1 -> previous year's last week)", () => {
    // ISO week 1, 2027 -> previous is ISO week 53 of 2026 (2026 has 53 ISO
    // weeks) -- a naive "current week number minus 1" would have produced
    // a nonsensical "week 0" here instead.
    const result = previousWeekRoundupImagePath(pool, MONDAY_2027_W01_UTC, 'America/Chicago');
    expect(result).toBe(pickFromPool(pool, 'weekly-2026-w53').path);
  });

  it('is deterministic -- the same current week always excludes the same past pick', () => {
    const first = previousWeekRoundupImagePath(pool, MONDAY_2026_W37_UTC, 'America/Chicago');
    const second = previousWeekRoundupImagePath(pool, MONDAY_2026_W37_UTC, 'America/Chicago');
    expect(first).toBe(second);
  });
});

describe('resolveImage', () => {
  const baseOptions = {
    town: 'moreno_valley_ca' as const,
    cityName: 'Moreno Valley',
    facilities: [] as Facility[],
    categoryImages: {},
  };

  it('tier 1 (What\'s On Phase 4): a Ticketmaster image outranks article, venue, and category', () => {
    const story: ResolvableStory = {
      title: 'A Touring Band Live in Brookings', source_type: 'event',
      image_path: EXISTING_IMAGE, image_alt: null, venue_raw: null,
      ticketmasterImageUrl: 'https://s1.ticketm.net/dam/real-photo.jpg',
      ticketmasterImageWidth: 2048, ticketmasterImageHeight: 1152,
    };
    const result = resolveImage(story, baseOptions);
    expect(result?.path).toBe('https://s1.ticketm.net/dam/real-photo.jpg');
    expect(result?.width).toBe(2048);
    expect(result?.height).toBe(1152);
  });

  it('tier 1: defaults to a 16:9 size when width/height are not provided', () => {
    const story: ResolvableStory = {
      title: 'A Touring Band Live in Brookings', source_type: 'event',
      image_path: null, image_alt: null, venue_raw: null,
      ticketmasterImageUrl: 'https://s1.ticketm.net/dam/real-photo.jpg',
    };
    const result = resolveImage(story, baseOptions);
    expect(result?.width).toBe(1600);
    expect(result?.height).toBe(900);
  });

  it('tier 1: falls through to article when ticketmasterImageUrl is an empty string', () => {
    const story: ResolvableStory = {
      title: 'Editorial', source_type: 'editorial', image_path: EXISTING_IMAGE,
      image_alt: 'A real alt', venue_raw: null,
      ticketmasterImageUrl: '',
    };
    const result = resolveImage(story, baseOptions);
    expect(result?.path).toBe(EXISTING_IMAGE);
  });

  it('tier 1: falls through to article when ticketmasterImageUrl is null', () => {
    const story: ResolvableStory = {
      title: 'Editorial', source_type: 'editorial', image_path: EXISTING_IMAGE,
      image_alt: 'A real alt', venue_raw: null,
      ticketmasterImageUrl: null,
    };
    const result = resolveImage(story, baseOptions);
    expect(result?.path).toBe(EXISTING_IMAGE);
  });

  it('tier 1: falls through to article when ticketmasterImageUrl is malformed (not an absolute http(s) URL) -- defensive, never errors', () => {
    const story: ResolvableStory = {
      title: 'Editorial', source_type: 'editorial', image_path: EXISTING_IMAGE,
      image_alt: 'A real alt', venue_raw: null,
      ticketmasterImageUrl: '/assets/images/not-a-real-hotlink.jpg',
    };
    const result = resolveImage(story, baseOptions);
    expect(result?.path).toBe(EXISTING_IMAGE);
  });

  it('tier 1: falls all the way through to null (not article/venue/category) when ticketmasterImageUrl is malformed and nothing else resolves', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: Free Food Giveaway (Every Sunday)', source_type: 'event',
      image_path: null, image_alt: null, venue_raw: null,
      ticketmasterImageUrl: 'not-a-url-at-all',
    };
    expect(resolveImage(story, baseOptions)).toBeNull();
  });

  it('regression check: a story item with no ticketmasterImageUrl field at all resolves exactly as before this phase', () => {
    const story: ResolvableStory = {
      title: 'Editorial', source_type: 'editorial', image_path: EXISTING_IMAGE,
      image_alt: 'A real alt', venue_raw: null,
    };
    const result = resolveImage(story, baseOptions);
    expect(result?.path).toBe(EXISTING_IMAGE);
    expect(result?.alt).toBe('A real alt');
  });

  it('tier 2: returns the article image when story.image_path is set', () => {
    const story: ResolvableStory = {
      title: 'Editorial', source_type: 'editorial', image_path: EXISTING_IMAGE,
      image_alt: 'A real alt', venue_raw: null,
    };
    const result = resolveImage(story, baseOptions);
    expect(result?.path).toBe(EXISTING_IMAGE);
    expect(result?.alt).toBe('A real alt');
  });

  it('tier 2: throws loudly when the resolved image_path does not exist on disk', () => {
    const story: ResolvableStory = {
      title: 'Editorial', source_type: 'editorial', image_path: '/assets/images/does-not-exist-12345.png',
      image_alt: null, venue_raw: null,
    };
    expect(() => resolveImage(story, baseOptions)).toThrow(/does-not-exist-12345\.png/);
  });

  it('tier 3: returns the resolved venue image when the title-prefix matches a facility', () => {
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

  it('tier 3: propagates a facility\'s image_attribution_text/url onto the resolved ImageRef', () => {
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

  it('tier 3: attributionText/Url are undefined (not null) when the facility has none', () => {
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

  it('tier 4: falls back to the category image when no venue matches', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: City Council Meeting', source_type: 'meeting',
      image_path: null, image_alt: null, venue_raw: null,
    };
    const categoryImage: ImageRef = { path: EXISTING_IMAGE, alt: 'City Hall', width: 1200, height: 800 };
    const result = resolveImage(story, { ...baseOptions, categoryImages: { city_hall: [categoryImage] } });
    expect(result).toEqual(categoryImage);
  });

  it('tier 4: picks from a multi-image pool instead of always the first entry', () => {
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

  it('tier 4: the SAME story always resolves to the SAME pool entry (stable across rebuilds)', () => {
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

  // Image-rotation follow-up, Part 2: usedImagePaths threaded through tier
  // 4 (see that option's own doc comment on ResolveImageOptions). Real,
  // distinct on-disk files (not the shared EXISTING_IMAGE constant, which
  // would make "different path" assertions meaningless) so
  // assertImageExists() exercises the real success path too.
  const A = '/assets/images/categories/brookings_sd-events-1.png';
  const B = '/assets/images/categories/brookings_sd-events-2.png';
  const C = '/assets/images/categories/brookings_sd-events-3.png';

  it('tier 4: usedImagePaths steers the pick away from an already-used pool entry when an alternative exists', () => {
    const pool: ImageRef[] = [
      { path: A, alt: 'A', width: 1200, height: 800, attributionText: 'Photo by A' },
      { path: B, alt: 'B', width: 1200, height: 800, attributionText: 'Photo by B' },
      { path: C, alt: 'C', width: 1200, height: 800, attributionText: 'Photo by C' },
    ];
    const story: ResolvableStory & { slug: string } = {
      slug: 'event-x', title: 'Event X', source_type: 'event', image_path: null, image_alt: null, venue_raw: null,
    };
    const options = { ...baseOptions, categoryImages: { events: pool } };
    const withoutExclusion = resolveImage(story, options)!;
    const withExclusion = resolveImage(story, { ...options, usedImagePaths: new Set([withoutExclusion.path]) })!;
    expect(withExclusion.path).not.toBe(withoutExclusion.path);
    // Part 4: whichever entry is actually returned still carries ITS OWN
    // attribution, not the excluded entry's or a mismatched one -- the pool
    // entry is returned whole, never reconstructed field-by-field.
    const matchingPoolEntry = pool.find((p) => p.path === withExclusion.path);
    expect(withExclusion.attributionText).toBe(matchingPoolEntry?.attributionText);
  });

  it('tier 4: usedImagePaths degrades to the normal pick when every pool entry is already used', () => {
    const pool: ImageRef[] = [
      { path: A, alt: 'A', width: 1200, height: 800 },
      { path: B, alt: 'B', width: 1200, height: 800 },
    ];
    const story: ResolvableStory & { slug: string } = {
      slug: 'event-y', title: 'Event Y', source_type: 'event', image_path: null, image_alt: null, venue_raw: null,
    };
    const options = { ...baseOptions, categoryImages: { events: pool } };
    const canonical = resolveImage(story, options);
    const stillResolved = resolveImage(story, { ...options, usedImagePaths: new Set([A, B]) });
    expect(stillResolved).toEqual(canonical);
  });

  // Image pool rotation (Addendum 2): a story with a stored
  // category_image_index uses that durable slot instead of the seed hash.
  it('tier 4: category_image_index picks the slot at that index (mod pool length)', () => {
    const pool: ImageRef[] = [
      { path: A, alt: 'A', width: 1200, height: 800 },
      { path: B, alt: 'B', width: 1200, height: 800 },
      { path: C, alt: 'C', width: 1200, height: 800 },
    ];
    const story: ResolvableStory = {
      title: 'Event', source_type: 'event', image_path: null, image_alt: null,
      venue_raw: null, category_image_index: 1,
    };
    const result = resolveImage(story, { ...baseOptions, categoryImages: { events: pool } });
    expect(result?.path).toBe(B);
  });

  it('tier 4: category_image_index wraps via modulo when it exceeds the pool length (pool shrank since assignment)', () => {
    const pool: ImageRef[] = [
      { path: A, alt: 'A', width: 1200, height: 800 },
      { path: B, alt: 'B', width: 1200, height: 800 },
    ];
    const story: ResolvableStory = {
      title: 'Event', source_type: 'event', image_path: null, image_alt: null,
      venue_raw: null, category_image_index: 5, // 5 % 2 === 1
    };
    const result = resolveImage(story, { ...baseOptions, categoryImages: { events: pool } });
    expect(result?.path).toBe(B);
  });

  it('tier 4: category_image_index of 0 is honored, not treated as falsy/missing', () => {
    const pool: ImageRef[] = [
      { path: A, alt: 'A', width: 1200, height: 800 },
      { path: B, alt: 'B', width: 1200, height: 800 },
    ];
    const story: ResolvableStory = {
      title: 'Event', source_type: 'event', image_path: null, image_alt: null,
      venue_raw: null, category_image_index: 0,
    };
    const result = resolveImage(story, { ...baseOptions, categoryImages: { events: pool } });
    expect(result?.path).toBe(A);
  });

  it('tier 4: falls back to the seed hash pick when category_image_index is null (not yet assigned)', () => {
    const pool: ImageRef[] = [
      { path: EXISTING_IMAGE, alt: 'A', width: 1200, height: 800 },
    ];
    const story: ResolvableStory = {
      title: 'Event', source_type: 'event', image_path: null, image_alt: null,
      venue_raw: null, category_image_index: null,
    };
    const result = resolveImage(story, { ...baseOptions, categoryImages: { events: pool } });
    expect(result?.path).toBe(EXISTING_IMAGE);
  });

  it('tier 4: usedImagePaths still steers away from the indexed slot when an alternative exists', () => {
    const pool: ImageRef[] = [
      { path: A, alt: 'A', width: 1200, height: 800 },
      { path: B, alt: 'B', width: 1200, height: 800 },
    ];
    const story: ResolvableStory = {
      title: 'Event', source_type: 'event', image_path: null, image_alt: null,
      venue_raw: null, category_image_index: 0,
    };
    const result = resolveImage(story, {
      ...baseOptions, categoryImages: { events: pool }, usedImagePaths: new Set([A]),
    });
    expect(result?.path).toBe(B);
  });

  // TMDB/pool handoff: media_recension is the one category-tier
  // source_type that also carries its own real, item-specific image_alt
  // (the film's own theme text) -- it must win over the pool image's
  // generic alt.
  it('tier 4: media_recension\'s own image_alt overrides the pool image\'s generic alt', () => {
    const pool: ImageRef[] = [
      { path: A, alt: 'A small-town cinema at dusk.', width: 1600, height: 900 },
    ];
    const story: ResolvableStory = {
      title: 'Review: A Made-Up Film', source_type: 'media_recension', image_path: null,
      image_alt: 'A quiet evening out at the movies, reviewing "A Made-Up Film".',
      venue_raw: null, category_image_index: 0,
    };
    const result = resolveImage(story, { ...baseOptions, categoryImages: { movie_review: pool } });
    expect(result?.path).toBe(A);
    expect(result?.alt).toBe('A quiet evening out at the movies, reviewing "A Made-Up Film".');
  });

  it('tier 4: falls back to the pool image\'s own generic alt when a category-tier story has no image_alt', () => {
    const pool: ImageRef[] = [
      { path: A, alt: 'A small-town cinema at dusk.', width: 1600, height: 900 },
    ];
    const story: ResolvableStory = {
      title: 'Review: A Made-Up Film', source_type: 'media_recension', image_path: null,
      image_alt: null, venue_raw: null, category_image_index: 0,
    };
    const result = resolveImage(story, { ...baseOptions, categoryImages: { movie_review: pool } });
    expect(result?.alt).toBe('A small-town cinema at dusk.');
  });

  it('tier 5: returns null, never the /og/<slug>.png social card', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: Free Food Giveaway (Every Sunday)', source_type: 'event',
      image_path: null, image_alt: null, venue_raw: null,
    };
    expect(resolveImage(story, baseOptions)).toBeNull();
  });

  it('tier 5 (What\'s On Phase 4 re-verification): still returns null, never /og/<slug>.png, when the new Ticketmaster tier is ALSO unpopulated -- the one invariant a silent regression here would actually matter for', () => {
    const story: ResolvableStory = {
      title: 'Moreno Valley: Free Food Giveaway (Every Sunday)', source_type: 'event',
      image_path: null, image_alt: null, venue_raw: null,
      ticketmasterImageUrl: null,
    };
    const result = resolveImage(story, baseOptions);
    expect(result).toBeNull();
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

  it('always requires movie_review -- media_recension runs for every town (TMDB/pool handoff)', () => {
    expect(requiredCategoriesFor({ townId: 'broomfield_co' })).toContain('movie_review');
    expect(requiredCategoriesFor({ townId: 'brookings_sd' })).toContain('movie_review');
    expect(requiredCategoriesFor({ townId: 'moreno_valley_ca' })).toContain('movie_review');
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
      city_hall: POOL, events: POOL, weather_alert: POOL, jobs: POOL, movie_review: POOL,
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

// --- content-track image coverage (see handoff "Build check for the
// article / content-track image tier") -------------------------------------

describe('findContentTrackRowsMissingImage', () => {
  it('returns rows with a null image_path', () => {
    const rows = [
      { slug: 'editorial-1', image_path: null },
      { slug: 'recipe-1', image_path: '/assets/images/recipe-1.png' },
    ];
    expect(findContentTrackRowsMissingImage(rows)).toEqual([{ slug: 'editorial-1', image_path: null }]);
  });

  it('treats an empty-string image_path the same as null', () => {
    const rows = [{ slug: 'editorial-1', image_path: '' }];
    expect(findContentTrackRowsMissingImage(rows)).toHaveLength(1);
  });

  it('returns an empty array when every row has a real image_path', () => {
    const rows = [
      { slug: 'editorial-1', image_path: '/assets/images/editorial-1.png' },
      { slug: 'recipe-1', image_path: '/assets/images/recipe-1.png' },
    ];
    expect(findContentTrackRowsMissingImage(rows)).toEqual([]);
  });

  it('returns every missing row, not just the first', () => {
    const rows = [
      { slug: 'a', image_path: null },
      { slug: 'b', image_path: '/x.png' },
      { slug: 'c', image_path: null },
    ];
    expect(findContentTrackRowsMissingImage(rows).map((r) => r.slug)).toEqual(['a', 'c']);
  });
});

describe('withThumbnailCrop', () => {
  // Real file on disk (see the "content-track images missing from
  // landing-page cards" handoff) -- generate_illustration.py's own
  // -4x3.png crop convention, checked directly rather than assumed.
  const REAL_IMAGE_WITH_CROP: ImageRef = {
    path: '/assets/images/editorial-2026-07-21-brookings_sd.png',
    alt: 'A quiet street.', width: 1600, height: 900,
  };

  it('swaps in the real 4:3 crop when the file exists', () => {
    const result = withThumbnailCrop(REAL_IMAGE_WITH_CROP);
    expect(result.path).toBe('/assets/images/editorial-2026-07-21-brookings_sd-4x3.png');
    expect(result.width).toBe(1200);
    expect(result.height).toBe(900);
  });

  it('preserves alt text from the original image, never blanking or replacing it', () => {
    const result = withThumbnailCrop(REAL_IMAGE_WITH_CROP);
    expect(result.alt).toBe('A quiet street.');
  });

  it('falls back to the original image when no crop file exists (venue/category images)', () => {
    const categoryImage: ImageRef = { path: EXISTING_IMAGE, alt: 'x', width: 1200, height: 800 };
    const result = withThumbnailCrop(categoryImage);
    expect(result).toBe(categoryImage);
  });

  it('falls back unchanged for a hotlinked (Unsplash) image', () => {
    const hotlinked: ImageRef = { path: 'https://images.unsplash.com/photo-123', alt: 'x', width: 1200, height: 800 };
    expect(withThumbnailCrop(hotlinked)).toBe(hotlinked);
  });

  it('derives the crop path from the resolved image path, not a separately-passed slug', () => {
    // Regression guard for the exact staleness found in [slug].astro's
    // additionalImages (which derives from story.slug alone and silently
    // stopped matching town-scoped filenames) -- this function must never
    // reproduce that by taking a slug as input at all.
    const nonExistent: ImageRef = { path: '/assets/images/does-not-exist-anywhere.png', alt: 'x', width: 1600, height: 900 };
    expect(withThumbnailCrop(nonExistent)).toBe(nonExistent);
  });
});

describe('contentTrackCropPaths', () => {
  it('returns both real crop paths, in order, for an image that has them', () => {
    const paths = contentTrackCropPaths('/assets/images/editorial-2026-07-21-brookings_sd.png');
    expect(paths).toEqual([
      '/assets/images/editorial-2026-07-21-brookings_sd-4x3.png',
      '/assets/images/editorial-2026-07-21-brookings_sd-1x1.png',
    ]);
  });

  it('derives from the path itself, correctly handling a town-scoped filename', () => {
    // Regression guard for the exact bug found in [slug].astro: deriving
    // from a bare story slug ("recipe-2026-08-27") would miss Broomfield's
    // real, town-scoped crop files entirely.
    const paths = contentTrackCropPaths('/assets/images/recipe-2026-08-27-broomfield_co.png');
    expect(paths.every((p) => p.includes('broomfield_co'))).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
  });

  it('returns an empty array when no crop files exist', () => {
    expect(contentTrackCropPaths('/assets/images/does-not-exist-anywhere.png')).toEqual([]);
  });

  it('returns an empty array for a hotlinked (Unsplash) path', () => {
    expect(contentTrackCropPaths('https://images.unsplash.com/photo-123')).toEqual([]);
  });

  it('returns an empty array for a path with no .png extension', () => {
    expect(contentTrackCropPaths('/assets/images/something.jpg')).toEqual([]);
  });
});
