import { describe, expect, it } from 'vitest';
import {
  normalizeVenueText, extractTitleVenuePrefix, buildNameAliasIndex,
  resolveVenueSlugForImage, categoryForSourceType, dedupeConsecutiveImages,
  resolveImage, type ImageRef, type ResolvableStory,
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
    const result = resolveImage(story, { ...baseOptions, categoryImages: { city_hall: categoryImage } });
    expect(result).toEqual(categoryImage);
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
