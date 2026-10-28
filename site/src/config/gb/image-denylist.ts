/** Photos that were approved once and must not be used: Q3 (2026-10-28, owner) found them under headings they do not illustrate
 *  (a tree-lined avenue and a car park under the "City Chambers" and "Events" heroes). Keyed by the SOURCE photo id, not by our
 *  own `glasgow-autumn-NN` id, so a later run of scripts/activate_glasgow_images.py that reuses the number for another photo does
 *  not lose that photo, and the same photo is not brought back under a new number. */
export const DENIED_SOURCE_PHOTO_IDS: Record<number, string> = {
  1155440286: 'West Carriageway, The Green (Wikimedia, Richard Sutcliffe): grass, trees and a car park; not a Glasgow landmark',
  1142360231: 'Autumn colours, Dorchester Avenue (Wikimedia, Richard Sutcliffe): a tree-lined avenue, a named street, not a landmark',
};

export const notDenied = <T extends { sourcePhotoId?: number }>(image: T): boolean =>
  image.sourcePhotoId === undefined || !(image.sourcePhotoId in DENIED_SOURCE_PHOTO_IDS);
