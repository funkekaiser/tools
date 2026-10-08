/* Verifies the counting that ships inside tools/words.html. The module is
   lifted straight out of the page, so this checks the code users actually run,
   not a copy of it. Node built-ins only.

   A naive counter is wrong in ways that look right: an emoji counted as two
   characters, an accent as a letter of its own, a sentence of Chinese as one
   word. Each of those has a known answer here. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'words.html'), 'utf8');

const start = page.indexOf('var WC = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the counting module in tools/words.html');
  process.exit(1);
}
const WC = new Function(page.slice(start, end + 6) + '\nreturn WC;')();

let fails = 0, checks = 0;
const eq = (got, want, msg) => {
  checks++;
  if (got !== want) { fails++; console.log(`FAIL ${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// ---- 1. characters are what you see ----
const C = [
  ['', 0, 0],
  ['hello world', 11, 10],
  ['e\u0301te\u0301', 3, 3],                          // été built from e + combining accent
  ['été', 3, 3],                            // the same word, precomposed
  ['👍🏽', 1, 1],                                     // emoji with a skin tone
  ['👨‍👩‍👧‍👦', 1, 1],                                 // a family: seven code points
  ['🇩🇪 🇫🇷', 3, 2],                                   // flags are pairs of letters underneath
  ['a\r\nb', 3, 2],                                   // a Windows line break is one
  ['\u0928\u092E\u0938\u094D\u0924\u0947', 3, 3],     // \u0928\u092E\u0938\u094D\u0924\u0947: Devanagari clusters
  ['한국어', 3, 3],
  ['a\u00A0b', 3, 2]                                  // a non-breaking space is still a space
];
for (const [s, chars, noSpace] of C) {
  const c = WC.count(s);
  eq(c.chars, chars, `characters in ${JSON.stringify(s)}`);
  eq(c.noSpace, noSpace, `characters without spaces in ${JSON.stringify(s)}`);
}
eq(WC.count('👨‍👩‍👧‍👦').codePoints, 7, 'code points in the family emoji');
eq(WC.count('👨‍👩‍👧‍👦').units, 11, 'UTF-16 units in the family emoji');
eq(WC.count('👨‍👩‍👧‍👦').bytes, Buffer.byteLength('👨‍👩‍👧‍👦'), 'UTF-8 bytes in the family emoji');
eq(WC.count('héllo wörld ✓ 日本').bytes, Buffer.byteLength('héllo wörld ✓ 日本'), 'UTF-8 bytes in mixed text');
console.log('characters: graphemes, code points and bytes checked');

// ---- 2. words ----
const W = [
  ['', 0],
  ['   \n\t ', 0],
  ['one', 1],
  ['  two   words  ', 2],
  ['line\nbreak\ttab', 3],
  ['well-known don\u2019t 3.14 e.g. a@b.com', 5],
  ['wait — what?', 2],                      // a lone dash is not a word
  ['👍 🎉 ok', 1],                           // nor is an emoji on its own
  ['cafe\u0301 cre\u0300me', 2],        // combining accents do not split words
  ['Привет, мир!', 2],
  ['안녕하세요 세계', 2],                       // Korean uses spaces
  ['我爱北京天安门。', 4],                      // 我 爱 北京 天安门
  ['私は学生です。', 4],                        // 私 は 学生 です
  ['東京tower', 2],
  ['ภาษาไทยง่ายนิดเดียว', 5]
];
for (const [s, want] of W) eq(WC.count(s).words, want, `words in ${JSON.stringify(s)}`);
console.log(`words: ${W.length} cases checked, including Chinese, Japanese and Thai`);

// ---- 3. sentences and paragraphs ----
const S = [
  ['', 0],
  ['No full stop at the end', 1],
  ['One. Two! Three? Four.', 4],
  ['Mr. Smith met Dr. Jones. They talked.', 2],
  ['J. R. R. Tolkien wrote it. Then he stopped.', 2],
  ['It cost $3.50 in the U.S. last year.', 1],
  ['Wait... what? Yes.', 2],                     // the dots run on into "what"
  ['今天天气很好。我们去公园吧！', 2],
  ['...', 0]
];
for (const [s, want] of S) eq(WC.count(s).sentences, want, `sentences in ${JSON.stringify(s)}`);

const P = [['', 0], ['one line', 1], ['a\nb\n\nc', 3], ['a\n\n\n\nb\n   \n', 2], ['a\r\nb', 2]];
for (const [s, want] of P) eq(WC.count(s).paragraphs, want, `paragraphs in ${JSON.stringify(s)}`);
console.log('sentences and paragraphs: checked, including titles and initials');

// ---- 4. text messages ----
const M = [
  // text, encoding, units, parts
  ['', 'GSM-7', 0, 1],
  ['a'.repeat(160), 'GSM-7', 160, 1],
  ['a'.repeat(161), 'GSM-7', 161, 2],
  ['a'.repeat(306), 'GSM-7', 306, 2],
  ['a'.repeat(307), 'GSM-7', 307, 3],
  ['€'.repeat(80), 'GSM-7', 160, 1],          // the euro sign costs two
  ['€'.repeat(81), 'GSM-7', 162, 2],
  ['a' + '€'.repeat(76) + 'b', 'GSM-7', 154, 1],
  ['a'.repeat(152) + '€' + 'b'.repeat(10), 'GSM-7', 164, 2],
  ['Ça coûte 5 €', 'UCS-2', 12, 1],           // û is not in the GSM set
  ['it\u2019s', 'UCS-2', 4, 1],               // a curly quote
  ['a'.repeat(70), 'GSM-7', 70, 1],
  ['é'.repeat(70) + '✓', 'UCS-2', 71, 2],
  ['😀'.repeat(35), 'UCS-2', 70, 1],
  ['😀'.repeat(36), 'UCS-2', 72, 2],
  ['a'.repeat(66) + '😀' + 'b'.repeat(10), 'UCS-2', 78, 2]
];
for (const [s, enc, units, parts] of M) {
  const m = WC.sms(s);
  const name = s.length > 20 ? `${JSON.stringify(s.slice(0, 12))}… (${s.length})` : JSON.stringify(s);
  eq(m.encoding, enc, `SMS encoding of ${name}`);
  eq(m.units, units, `SMS units of ${name}`);
  eq(m.parts, parts, `SMS parts of ${name}`);
}
// A two-unit character never straddles parts: 152 GSM letters fill part one
// to 152, and the euro sign has to start part two.
{
  const m = WC.sms('a'.repeat(152) + '€' + 'b'.repeat(152));
  eq(m.units, 306, 'units with a euro sign at the boundary');
  eq(m.parts, 3, 'a euro sign at the part boundary pushes it to a third part');
}
eq(WC.sms('it\u2019s').odd, '\u2019', 'the character that forced UCS-2 is reported');
eq(WC.sms('a\u00A0b').encoding, 'UCS-2', 'a non-breaking space is not in the GSM set');
console.log(`text messages: ${M.length + 1} cases checked`);

// ---- 5. Twitter ----
const X = [
  ['', 0],
  ['a'.repeat(280), 280],
  ['hello world', 11],
  ['日本語', 6],
  ['한국어', 6],
  ['Привет', 6],
  ['😷', 2],
  ['👨‍👩‍👧‍👦', 2],
  ['👍🏽 ok', 5],
  ['🇩🇪', 2],
  ['café', 4],
  ['cafe\u0301', 4],                              // normalised first, so the same as above
  ['see https://example.com/some/very/long/path?with=query', 27],
  ['see https://example.com.', 28],               // the full stop is not part of the link
  ['www.example.org', 23],
  ['\u2014\u201C\u201D', 3],                       // dashes and quotes are in the light ranges
  ['\u3001', 2]
];
for (const [s, want] of X) eq(WC.xLength(s), want, `Twitter length of ${JSON.stringify(s)}`);
console.log(`Twitter: ${X.length} cases checked`);

// ---- 6. the limits and the words put on the numbers ----
{
  const s = 'a'.repeat(170);
  const l = Object.fromEntries(WC.limits(s, WC.count(s)).map((x) => [x.id, x]));
  eq(l.sms.say, '2 texts', 'a 170-letter text is sent as two');
  eq(l.x.say, 'Fits', '170 letters fit on Twitter');
  eq(l.title.say, '110 over', '170 letters are 110 over a search title');
  eq(l.desc.tone, 'bad', '170 letters are too long for a search description');
  eq(l.bsky.tone, 'ok', '170 letters fit on Bluesky');
}
{
  const s = '👍'.repeat(300);
  const l = Object.fromEntries(WC.limits(s, WC.count(s)).map((x) => [x.id, x]));
  eq(l.bsky.say, 'Fits', 'Bluesky counts 300 emoji as 300');
  eq(l.x.say, '320 over', 'Twitter counts 300 emoji as 600');
}
const D = [[0, '—'], [0.2, 'under a minute'], [1, 'about 1 minute'], [4.4, 'about 4 minutes'],
  [59.4, 'about 59 minutes'], [59.6, 'about 1 hour'], [72, 'about 1 hour 10 minutes'], [150, 'about 2 hours 30 minutes']];
for (const [m, want] of D) eq(WC.duration(m), want, `duration(${m})`);
{
  const c = WC.count('word '.repeat(476));
  eq(WC.duration(c.read), 'about 2 minutes', '476 words take two minutes to read');
  eq(WC.duration(c.say), 'about 3 minutes', '476 words take three or four minutes to say');
  const z = WC.count('日本語'.repeat(200));
  eq(WC.duration(z.read), 'about 2 minutes', '600 Japanese characters take two minutes to read');
}
console.log('limits and wording: checked');

console.log(fails ? `\n${fails} of ${checks} checks failed` : `\nall ${checks} word counter checks passed`);
process.exit(fails ? 1 : 0);
