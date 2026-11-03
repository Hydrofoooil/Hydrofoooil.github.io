#!/usr/bin/env node
// Rebuild the static blog from every blog/<slug>/index.md, with the same renderer the
// in-browser editor (/blog/write/) uses (blog/lib/blog-core.mjs). Writes each post's
// index.html, the list at blog/index.html and the Atom feed blog/feed.xml; removes the old
// page of a post that became a draft or lost its index.md. Usage:  node scripts/build_blog.mjs
import { createHash } from 'node:crypto';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER, RESERVED_SLUGS, buildBlog } from '../blog/lib/blog-core.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const blog = join(root, 'blog');
const readText = path => readFile(path, 'utf8').catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));

const cssVersion = createHash('sha1').update(await readFile(join(blog, 'blog.css'))).digest('hex').slice(0, 8);
const folders = (await readdir(blog, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !RESERVED_SLUGS.has(entry.name))
  .map(entry => entry.name).sort();

const sources = [], orphans = [];
for (const slug of folders) {
  const source = await readText(join(blog, slug, 'index.md'));
  if (source === null) orphans.push(slug);
  else sources.push({ slug, source });
}
const { files, posts, unpublished, errors } = buildBlog(sources, { cssVersion });
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
for (const [path, text] of Object.entries(files)) {
  const target = join(root, path);
  if ((await readText(target)) !== text) {
    await writeFile(target, text);
    console.log('wrote', path);
  }
}
for (const slug of [...unpublished, ...orphans]) {
  const target = join(blog, slug, 'index.html');
  const old = await readText(target);
  if (old !== null && old.includes(MARKER)) {
    await unlink(target); // draft or deleted post: take its old page down
    console.log('removed', relative(root, target));
  }
}
console.log(`${posts.length} post(s) published`);
