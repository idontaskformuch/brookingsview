/** The country's sports wording (strings/{us,gb}/sports.json -- the same file the Python side reads). */
import us from '../../../strings/us/sports.json';
import gb from '../../../strings/gb/sports.json';

export type SportTerms = typeof us.terms;

export const sportTerms = (country: string): SportTerms => (country === 'gb' ? gb.terms : us.terms);
