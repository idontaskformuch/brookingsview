/** The UK publication gate (ai_pipeline/uk_guardrails.py, Glasgow spec phase 5) for text that is shown verbatim on a page: an agenda title that
 *  names a private individual or a court proceeding is left out (the meeting itself stays). Fail-closed and over-matching on purpose, exactly like
 *  the Python gate: a false hold costs one agenda line, a false pass is a legal risk.
 *
 *  This is a port, not a redesign. The word lists are the Python lists and a test (meetings-towns.test.ts) reads the Python file and fails if they
 *  differ; a second test replays real Glasgow titles through the Python gate's verdicts. Change the rules in Python first, then here. */

const PUBLIC_TITLE = String.raw`(?:Lord\s+Provost|Depute\s+Provost|Provost|Councillors?|Cllrs?\.?|Bailie|MSPs?|MPs?|MEPs?|First\s+Minister)`;
const NAME_WORD = String.raw`[A-Z][A-Za-z'’-]+`;
const PUBLIC_OFFICE_SPAN = new RegExp(
  String.raw`\b${PUBLIC_TITLE}\s+${NAME_WORD}(?:\s+${NAME_WORD}){0,2}(?:\s+and\s+${NAME_WORD}(?:\s+${NAME_WORD}){0,2})?`, 'g',
);

const OFFENCE_NAMES = String.raw`murder|manslaughter|culpable\s+homicide|assault(?:ed)?|stabb(?:ed|ing)`;
const PROCEEDING = String.raw`arrest(?:s|ed|ing)?|charged|charges?\s+(?:of|against|with)|accused|suspects?|suspected|` +
  String.raw`alleged(?:ly)?|offender|perpetrator|` +
  String.raw`sheriff(?:\s+court|\s+principal)?|sheriffs|high\s+court|court\s+of\s+session|justiciary|` +
  String.raw`procurator\s+fiscal|crown\s+office|indict(?:ed|ment)|trial|jury|` +
  String.raw`convict(?:ed|ion|ions)|sentenc(?:e|ed|ing)|remand(?:ed)?|bail|` +
  String.raw`pleaded|plea\s+hearing|appeared\s+in\s+court|court\s+appearance|` +
  String.raw`police\s+(?:investigat\w+|enquir\w+)|under\s+investigation`;
const CONTEMPT = new RegExp(String.raw`\b(${PROCEEDING}|${OFFENCE_NAMES})\b`, 'i');

const PERSONAL_LICENCE = /\bpersonal\s+licen[cs]e/i;
/** JavaScript has no inline (?i:...) on the Node versions a build may run on: the role words are spelled out case-insensitively instead. */
const ci = (s: string) => s.replace(/(\.)|([A-Za-z])/g, (_m, esc: string | undefined, ch: string | undefined) => (esc ? esc : `[${ch!.toLowerCase()}${ch!.toUpperCase()}]`));
const ROLE_NAME = new RegExp(
  String.raw`\b(?:` + ci(String.raw`applicants?|appellants?|objectors?|complainers?|complainants?|respondents?|licen(?:c|s)e\s*holders?|licen(?:c|s)ees?|(?:premises|personal)\s+licen(?:c|s)e\s*holders?|on\s+behalf\s+of|application\s+by|appeal\s+by|objection\s+by|submitted\s+by|agent`) + `)` +
  String.raw`\s*[:\-–]?\s*(?:is\s+|are\s+)?(?:(?:Mr|Mrs|Ms|Miss|Mx|Dr)\.?\s+)?(${NAME_WORD}\s+${NAME_WORD})`, 'g',
);
const HONORIFIC_NAME = new RegExp(String.raw`\b(?:Mr|Mrs|Ms|Miss|Mx|Dr)\.?\s+${NAME_WORD}`);

export const FIRST_NAMES: ReadonlySet<string> = new Set(`
Aaron Abigail Adam Agnes Aidan Aileen Alan Alasdair Alastair Alexander Alexandra Alice Alison Allan Amanda Amy Andrea Andrew Angus Anita Ann Anna Anne
Annie Anthony Archie Arthur Barbara Barry Ben Benjamin Beth Bethany Billy Bob Brian Bruce Callum Calum Cameron Campbell Carol Caroline Catherine
Charles Charlotte Chloe Chris Christine Christopher Claire Colin Connor Craig Daniel Darren David Dawn Debbie Deborah Declan Denise Dennis Derek Diane
Donald Donna Douglas Duncan Edward Eilidh Elaine Eleanor Elizabeth Ellen Emily Emma Eric Euan Evelyn Ewan Fiona Frances Francis Frank Gary Gavin
George Gerald Gillian Gordon Graeme Graham Grant Gregor Gregory Hamish Hannah Harry Heather Helen Henry Hugh Iain Ian Isabel Isla Jack Jacqueline Jake
James Jamie Jane Janet Jason Jean Jeffrey Jennifer Jenny Jessica Jill Joan Joanne John Jonathan Joseph Joshua Joyce Julie Karen Kate Katherine
Kathleen Kathryn Keith Kelly Kenneth Kevin Kirsty Kyle Laura Lauren Lee Leslie Lesley Linda Lindsay Lisa Liam Lorna Louise Lucy Lynn Lynne Malcolm
Margaret Maria Marion Mark Martin Mary Matthew Maureen Megan Melanie Michael Michelle Mohammed Mohammad Muhammad Morag Moira Murdo Murray Nancy
Natalie Neil Nicola Nicole Nigel Norman Olivia Pamela Patricia Patrick Paul Pauline Peter Philip Rachel Ralph Rebecca Reece Richard Robert Robin Rona
Ronald Rory Rosemary Ross Roy Ruairi Ruari Russell Ruth Ryan Sally Samantha Samuel Sandra Sarah Scott Sean Shaun Sheila Shona Simon Sophie Stephanie
Stephen Steven Stewart Stuart Susan Suzanne Tam Tanya Terence Teresa Thomas Tracy Tom Tony Valerie Victor Vincent Wendy William Yvonne Zoe
`.split(/\s+/).filter(Boolean));

/** A surname slot holding one of these is a street / place / organisation ("Victoria Park", "Charlotte Street"), not a person. */
export const PLACE_WORDS: ReadonlySet<string> = new Set(`
Street St Road Rd Park Drive Avenue Ave Place Lane Gardens Garden Square Hospital School Crescent Terrace Court Way Hall Centre Cent_er Church Bridge
Cross Area Partnership Primary Secondary Academy Library Station Row Circus Brae Green Quay Wynd Close Hill Hills Gate Walk Path Grove Mews Brae Yard
Wharf Port Loan Rise View Gait Cathedral Hotel Pub Bar Club Cafe Restaurant Shop Store Lodge House Mill Works Estate Campus University College Museum
Gallery Theatre Cinema Arena Stadium Pool Baths Market Mall Retail Industrial Business Housing Association Trust Council Committee Board Group
Foundation Fund Limited Ltd Plc Services Service Hub
`.replace('Cent_er', ['Cent', 'er'].join('')).split(/\s+/).filter(Boolean));

const WORD = /[A-Za-z'’-]+/g;

/** Only spaces/tabs between two matched words (no colon, comma, full stop or line break). */
function plainGap(text: string, leftEnd: number, rightStart: number): boolean {
  return text.slice(leftEnd, rightStart).replace(/^[ \t]+|[ \t]+$/g, '') === '';
}

function firstNameSurnameHit(text: string): boolean {
  const words = [...text.matchAll(WORD)].map((m) => ({ w: m[0], start: m.index!, end: m.index! + m[0].length }));
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    if (!plainGap(text, a.end, b.start)) continue;
    if (FIRST_NAMES.has(a.w) && /^[A-Z]/.test(b.w) && !PLACE_WORDS.has(b.w)) {
      const c = words[i + 2];
      const after = c && plainGap(text, b.end, c.start) ? c.w : '';
      if (PLACE_WORDS.has(after)) continue;
      return true;
    }
  }
  return false;
}

/** True when the text may name a private individual (personal licence, role + name, honorific + name, first name + surname). */
export function namesPrivatePerson(text: string): boolean {
  const t = (text ?? '').replace(PUBLIC_OFFICE_SPAN, ' ');
  ROLE_NAME.lastIndex = 0;
  return PERSONAL_LICENCE.test(t) || ROLE_NAME.test(t) || HONORIFIC_NAME.test(t) || firstNameSurnameHit(t);
}

/** True when the text mentions a proceeding or an offence (Scottish contempt-of-court net). */
export function mentionsProceeding(text: string): boolean {
  return CONTEMPT.test(text ?? '');
}

/** The gate for one verbatim line: true = hold it back. */
export function ukTitleHeld(text: string): boolean {
  return mentionsProceeding(text) || namesPrivatePerson(text);
}
