// Forgiving run-name search: "grizz lo" finds "Grizzly (Lower)".

// How well a name matched, best first
const enum Score {
  StartsName = 0, // words match in order, beginning with the name's first word
  InOrder = 1, // words match in order, starting later in the name
  AnyOrder = 2,
  Substring = 3, // typed text appears mid-word
  Loose = 4, // letters skipped, e.g. "grzly"; only used when nothing better matches
}

// Shorter tokens match too much when letters can be skipped
const MIN_LOOSE_LENGTH = 3;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Same first letter, then the rest of the token appears in order
function looseMatch(token: string, word: string): boolean {
  if (token.length < MIN_LOOSE_LENGTH || token[0] !== word[0]) return false;
  let at = 0;
  for (const char of token) {
    at = word.indexOf(char, at) + 1;
    if (at === 0) return false;
  }
  return true;
}

// Can every token claim its own word? Backtracks, so "b be" still matches "Bear Black".
function assign(
  tokens: string[],
  nameWords: string[],
  matches: (token: string, word: string) => boolean,
  inOrder: boolean,
  used = new Set<number>(),
  t = 0,
  from = 0,
): boolean {
  if (t === tokens.length) return true;
  for (let w = inOrder ? from : 0; w < nameWords.length; w++) {
    if (used.has(w) || !matches(tokens[t], nameWords[w])) continue;
    used.add(w);
    const found = assign(tokens, nameWords, matches, inOrder, used, t + 1, w + 1);
    used.delete(w);
    if (found) return true;
  }
  return false;
}

function scoreName(tokens: string[], name: string): Score | null {
  const nameWords = words(name);
  const isPrefix = (token: string, word: string) => word.startsWith(token);

  if (assign(tokens, nameWords, isPrefix, true)) {
    return nameWords[0]?.startsWith(tokens[0]) ? Score.StartsName : Score.InOrder;
  }
  if (assign(tokens, nameWords, isPrefix, false)) return Score.AnyOrder;
  // Compared with spaces and punctuation removed, so "cubway" finds "Cub Way"
  if (nameWords.join('').includes(tokens.join(''))) return Score.Substring;
  if (assign(tokens, nameWords, (token, word) => isPrefix(token, word) || looseMatch(token, word), false)) {
    return Score.Loose;
  }
  return null;
}

/** Matching items, best first. Equal matches keep their original order. */
export function searchByName<T extends { name: string }>(items: T[], query: string): T[] {
  const tokens = words(query);
  if (tokens.length === 0) return [];

  const scored: { item: T; score: Score }[] = [];
  for (const item of items) {
    const score = scoreName(tokens, item.name);
    if (score !== null) scored.push({ item, score });
  }

  const hasCloseMatch = scored.some(s => s.score < Score.Loose);
  return scored
    .filter(s => !hasCloseMatch || s.score < Score.Loose)
    .sort((a, b) => a.score - b.score)
    .map(s => s.item);
}
