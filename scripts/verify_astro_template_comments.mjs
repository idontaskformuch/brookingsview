#!/usr/bin/env node
/**
 * No JS comments in Astro templates (QA build.astro-template-comment, owner 2026-11-25). Twice on 2026-11-25 a comment inside a template
 * expression gave a green build with no component CSS on any page: `{optIn ? ( /* ... *\/ <p>` in components/CookieBanner.astro (e8bfdd50)
 * and `{/* ... *\/}` inside `{next && (<section>...` in components/meetings/MeetingsUpcoming.astro (the working copy of 0d1a1347).
 * scripts/verify_page_css.mjs catches the result; this catches the cause, before a build.
 *
 * Every .astro file is parsed with Astro's own parser (@astrojs/compiler-rs, from site/node_modules), so JSX text ("Don't", "a // b")
 * and attribute values are never mistaken for code. A `//` or `/* *\/` comment fails when it is after the frontmatter and outside every
 * <script> and <style> element. Frontmatter comments, <script> comments and HTML comments (<!-- -->) are fine.
 *
 * Usage: node scripts/verify_astro_template_comments.mjs [file-or-dir ...]   (default: site/src)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(ROOT, 'site', 'package.json'));
const { parse } = await import(pathToFileURL(req.resolve('@astrojs/compiler-rs')).href);

function walk(p, out = []) {
  if (statSync(p).isDirectory()) {
    for (const name of readdirSync(p)) if (name !== 'node_modules') walk(join(p, name), out);
  } else if (p.endsWith('.astro')) out.push(p);
  return out;
}

/** [start, end) of every <script> and <style> element anywhere in the tree. */
function rawRanges(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) rawRanges(n, out); return out; }
  if (node.type === 'JSXElement' && ['script', 'style'].includes(node.openingElement?.name?.name)) out.push([node.start, node.end]);
  for (const [k, v] of Object.entries(node)) if (k !== 'comments' && v && typeof v === 'object') rawRanges(v, out);
  return out;
}

const lineOf = (src, at) => src.slice(0, at).split('\n').length;

/** Comments in the template of one .astro source: [{ line, text }]. */
export function templateComments(src) {
  const { ast } = parse(src);
  const fmEnd = ast.frontmatter?.end ?? 0;
  const raw = rawRanges(ast.body);
  return (ast.comments ?? [])
    .filter((c) => c.start >= fmEnd && !raw.some(([s, e]) => c.start >= s && c.end <= e))
    .map((c) => ({ line: lineOf(src, c.start), text: src.slice(c.start, c.end).replace(/\s+/g, ' ').slice(0, 80) }));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : [join(ROOT, 'site', 'src')];
  const files = targets.flatMap((t) => walk(resolve(t)));
  const bad = [];
  for (const f of files) {
    for (const c of templateComments(readFileSync(f, 'utf8'))) bad.push(`${relative(ROOT, f).split('\\').join('/')}:${c.line}: ${c.text}`);
  }
  if (bad.length) {
    console.error(bad.join('\n'));
    console.error(`FAIL: ${bad.length} JS comment(s) in Astro templates (move them to the frontmatter; HTML comments <!-- --> stay out of the build)`);
    process.exit(1);
  }
  console.log(`OK: no JS comments in the templates of ${files.length} .astro files.`);
}
