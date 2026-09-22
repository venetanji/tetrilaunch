// Checks the Play listing copy in docs/PLAY.md against Play's field limits.
//
// The Console truncates over-length copy at paste time rather than refusing it,
// so an over-long short description ships as a sentence cut off mid-word and
// nobody notices until it is live. Cheaper to assert here.
//
// Four fields, all of them Play's. The App Store's own limits are looser than
// these for every field the two stores share, so copy that passes here fits
// there — see the note under docs/PLAY.md's What's new block.
//
//   npm run store:copy
//
// The copy lives in docs/PLAY.md rather than in a data file on purpose: it is
// read and edited far more often than it is validated, and a doc you paste out
// of beats a JSON file you have to render first. This just parses it back.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "PLAY.md");

// label -> [heading as it appears in the doc, Play's limit]
const FIELDS = [
  ["App name", /\*\*App name\*\*\s*\(30 max\):\s*`([^`]+)`/, 30],
  // \r?\n rather than \n: with core.autocrlf the working tree serves this doc
  // with CRLF endings, and a fence regex anchored on bare \n never matches.
  ["Short description", /\*\*Short description\*\*\s*\(80 max\):\s*\n+```\r?\n([\s\S]*?)\r?\n```/, 80],
  ["Full description", /\*\*Full description\*\*\s*\(4000 max\):\s*\n+```\r?\n([\s\S]*?)\r?\n```/, 4000],
  // WHAT'S NEW IS THE FIELD THIS SCRIPT WAS MISSING, and it is the one with the
  // worst ratio between what a release produces and what the field holds. The
  // 1.0.6 release page carried a "paste-ready for the store 'what's new'
  // fields" draft of 5,028 code points against Play's 500 — and because the
  // Console truncates a long paste rather than refusing it, that ships as a
  // listing note cut off inside its first subsection. Nothing would have said
  // so: this script checked three fields and the doc had no fourth.
  //
  // Checked against docs/PLAY.md rather than against docs/releases/<v>.md, on
  // purpose. The release page is a different document with a different job (a
  // GitHub release body, which is a page someone reads deliberately and where
  // 5,000 characters is the right size), it lives on the release branch rather
  // than in every checkout, and a check that can only run where a
  // version-named file happens to exist is a check that quietly does not run.
  // Keeping the field beside the other three means one source for the copy, one
  // limit per field, and a store:copy that means the same thing on any branch.
  // Missing is a failure here, same as the others — the block is in the doc.
  ["What's new", /\*\*What's new\*\*\s*\(500 max\):\s*\n+```\r?\n([\s\S]*?)\r?\n```/, 500],
];

const doc = await readFile(DOC, "utf8");

let failed = 0;
for (const [label, pattern, limit] of FIELDS) {
  const m = doc.match(pattern);
  if (!m) {
    console.error(`✗ ${label}: not found in docs/PLAY.md — did the heading change?`);
    failed++;
    continue;
  }

  // Play counts characters, not bytes, and counts a trailing newline in a
  // textarea. Trim, then measure by code point so an emoji or a — costs what
  // the Console will charge for it rather than its UTF-16 length.
  const text = m[1].replace(/\r\n/g, "\n").trim();
  const len = [...text].length;

  if (len > limit) {
    console.error(`✗ ${label}: ${len} chars, limit ${limit} (${len - limit} over)`);
    failed++;
  } else {
    console.log(`✓ ${label}: ${len}/${limit}`);
  }
}

if (failed) {
  console.error(`\n${failed} field(s) over limit or missing. Play truncates silently — fix before pasting.`);
  process.exit(1);
}
