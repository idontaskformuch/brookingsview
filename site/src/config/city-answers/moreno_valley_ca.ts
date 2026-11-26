/** Moreno Valley answer pages (Fas 3). Facts from the City of Moreno Valley's Solid Waste & Recycling pages, read once each through
 *  PoliteFetcher (ViewMediaBot); evidence in .claude/evidence/city-answers-2026-11/. */
import type { AnswerPage } from './types';

const TREE_SOURCE = { name: 'City of Moreno Valley: Christmas Tree Pickup', url: 'https://ci.moreno-valley.ca.us/resident_services/waste/special-xmastree.html' };

/** M1 (owner 2026-11-19: time-critical, published first). Source text, read 2026-11-19: "Waste Management of the Inland Empire collects and
 *  recycles Christmas trees for the first two weeks following Christmas on your regular collection day." The dates below apply that rule
 *  (the two weeks from 26 December); the source names no dates. */
export const MORENO_VALLEY_ANSWERS: AnswerPage[] = [
  {
    slug: 'christmas-tree-pickup',
    title: 'Moreno Valley Christmas Tree Pickup 2026',
    h1: 'Moreno Valley Christmas tree pickup: when and how',
    description: 'When Waste Management picks up Christmas trees in Moreno Valley after Christmas 2026, and how to get your tree ready for the curb.',
    about: 'When and how Moreno Valley picks up Christmas trees, from the City of Moreno Valley\'s Solid Waste & Recycling page. The dates apply the city\'s rule (the first two weeks after Christmas); the city\'s page is the authority.',
    answers: [
      {
        id: 'when',
        question: 'When is my Christmas tree picked up?',
        blocks: [
          { kind: 'p', text: '**On your regular collection day**, during the first two weeks after Christmas. Waste Management of the Inland Empire collects the trees and recycles them.' },
          {
            kind: 'season', to: '2027-01-08',
            during: 'For this season that is **December 26, 2026 to January 8, 2027**.',
            after: 'The 2026 pickup ran December 26, 2026 to January 8, 2027 and is over.',
          },
        ],
        actions: [{ label: 'The city\'s Christmas tree pickup page', href: TREE_SOURCE.url }],
        faq: 'Waste Management of the Inland Empire picks up Christmas trees on your regular collection day during the first two weeks after Christmas: December 26, 2026 to January 8, 2027.',
        sources: [TREE_SOURCE],
        checked: '2026-11-19',
        checkAt: '2026-12-15',
      },
      {
        id: 'prepare',
        question: 'How do I get my tree ready?',
        blocks: [
          { kind: 'list', items: [
            '**Cut it in half** if it is longer than six feet.',
            '**Remove all tinsel, metal ornaments and metal stands.**',
            'Flocked trees are collected but cannot be recycled.',
          ] },
        ],
        faq: 'Cut a tree longer than six feet in half, and remove all tinsel, metal ornaments and metal stands. Flocked trees are collected but cannot be recycled.',
        sources: [TREE_SOURCE],
        checked: '2026-11-19',
        checkAt: '2026-12-15',
      },
    ],
  },
];
