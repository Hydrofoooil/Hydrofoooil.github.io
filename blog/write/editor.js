// In-browser blog editor for /blog/write/.
// Composing and previewing work offline; the token is only needed for the post list,
// publishing and deleting. Rendering and building reuse blog-core.mjs, so a post
// published here is byte-for-byte what scripts/build_blog.mjs would write.
import {
  PostError,
  RESERVED_SLUGS,
  SLUG_PATTERN,
  buildBlog,
  esc,
  parseFrontMatter,
  readPost,
  renderPost,
  serializePost,
  slugify,
} from '../lib/blog-core.mjs';
import TurndownService from '../lib/vendor/turndown.browser.es.js';
import { gfm } from '../lib/vendor/turndown-plugin-gfm.browser.es.js';
import { GitHubError, GitHubRepo, REPO_PATH, base64ToBytes, describeError, sha1Hex } from './github.js';

const MAX_IMAGE_SIDE = 2000;
const WEBP_QUALITY = 0.85;
const AUTOSAVE_LIMIT = 4_000_000;
const PREVIEW_DELAY = 300;
const AUTOSAVE_DELAY = 600;
const POLL_INTERVAL = 5000;
const POLL_TIMEOUT = 5 * 60 * 1000;

const TOKEN_KEY = 'blog-editor:token';
const NEW_DRAFT_KEY = 'blog-editor:draft:new';

// ---------------------------------------------------------------- dom

const $ = id => document.getElementById(id);
const titleEl = $('post-title');
const slugEl = $('post-slug');
const slugNote = $('slug-note');
const dateEl = $('post-date');
const tagsEl = $('post-tags');
const langEl = $('post-lang');
const summaryEl = $('post-summary');
const draftEl = $('post-draft');
const bodyEl = $('post-body');
const formEl = $('post-form');
const publishButton = $('publish-button');
const deleteButton = $('delete-button');
const publishStatus = $('publish-status');
const formError = $('form-error');
const newPostButton = $('new-post');
const postListEl = $('post-list');
const listHint = $('list-hint');
const settingsEl = $('settings');
const settingsToggle = $('settings-toggle');
const tokenInput = $('token-input');
const rememberToken = $('remember-token');
const verifyButton = $('verify-token');
const clearTokenButton = $('clear-token');
const tokenStatus = $('token-status');
const autosaveNote = $('autosave-note');
const restoreBanner = $('restore-banner');
const restoreText = $('restore-text');
const restoreAccept = $('restore-accept');
const restoreDiscard = $('restore-discard');
const previewFrame = $('preview');
const previewNote = $('preview-note');
const imageInput = $('image-input');
const toastEl = $('toast');

// ---------------------------------------------------------------- state

let previewRun = 0;

const state = {
  token: '',
  verified: false,
  gh: null,
  repo: null,
  posts: [],
  current: { mode: 'new', slug: '' },
  pending: new Map(), // name -> { blob, dataURL }
  slugTouched: false,
  langTouched: false,
  baseForm: null,
  savedAutosave: null,
  cssText: '',
  cssVersion: '',
  cssPromise: null,
  previewTimer: 0,
  autosaveTimer: 0,
  toastTimer: 0,
  busy: false,
  imageDataCache: new Map(), // absolute image URL -> data URL
};

// ---------------------------------------------------------------- small helpers

function todayLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.toISOString().slice(0, 10) === value;
}

function shownDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replace(/-/g, '.') : date;
}

function formatTime(stamp) {
  if (!stamp) return '未知时间';
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return `${date.toLocaleDateString('zh-CN')} ${date.toLocaleTimeString('zh-CN', { hour12: false })}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setStatus(element, text, kind = '', link = null) {
  element.textContent = '';
  element.classList.toggle('is-error', kind === 'error');
  element.classList.toggle('is-ok', kind === 'ok');
  if (text) element.append(document.createTextNode(text));
  if (link) {
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.className = 'status-link';
    anchor.textContent = link.text;
    element.append(anchor);
  }
}

function setFormError(text) {
  if (!text) {
    formError.hidden = true;
    formError.textContent = '';
    return;
  }
  formError.hidden = false;
  formError.textContent = text;
}

function showToast(text, ms = 6500) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function setBusy(busy) {
  state.busy = busy;
  publishButton.disabled = busy;
  deleteButton.disabled = busy;
  newPostButton.disabled = busy;
  verifyButton.disabled = busy;
  clearTokenButton.disabled = busy;
}

// ---------------------------------------------------------------- form model

function readForm() {
  return {
    title: titleEl.value,
    slug: slugEl.value.trim(),
    date: dateEl.value,
    tags: tagsEl.value,
    summary: summaryEl.value,
    lang: langEl.value,
    draft: draftEl.checked,
    body: bodyEl.value,
  };
}

function splitTags(raw) {
  return String(raw).split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
}

function metaFrom(form) {
  const meta = {
    title: form.title.trim(),
    date: form.date,
    lang: form.lang,
    draft: form.draft,
  };
  const tags = splitTags(form.tags);
  if (tags.length) meta.tags = tags;
  const summary = form.summary.trim();
  if (summary) meta.summary = summary;
  return meta;
}

function formsEqual(a, b) {
  if (!a || !b) return false;
  return ['title', 'slug', 'date', 'tags', 'summary', 'lang', 'body'].every(key => String(a[key] ?? '') === String(b[key] ?? ''))
    && Boolean(a.draft) === Boolean(b.draft);
}

function isEmptyForm(form) {
  return !form.title.trim() && !form.slug && !form.tags.trim() && !form.summary.trim() && !form.body.trim();
}

function applyForm(form) {
  titleEl.value = form.title ?? '';
  slugEl.value = form.slug ?? '';
  dateEl.value = isValidDate(form.date) ? form.date : '';
  tagsEl.value = form.tags ?? '';
  summaryEl.value = form.summary ?? '';
  langEl.value = form.lang === 'zh-CN' ? 'zh-CN' : 'en';
  draftEl.checked = Boolean(form.draft);
  bodyEl.value = form.body ?? '';
  updatePublishLabel();
}

function updatePublishLabel() {
  if (draftEl.checked) publishButton.textContent = '保存草稿';
  else publishButton.textContent = state.current.mode === 'existing' ? '保存修改' : '发布';
}

// ---------------------------------------------------------------- slug + language

function isSlugTaken(slug) {
  if (RESERVED_SLUGS.has(slug)) return true;
  if (state.posts.some(post => post.slug === slug)) return true;
  return (state.repo?.sources || []).some(source => source.slug === slug);
}

function autoSlugValue() {
  const base = slugify(titleEl.value);
  const date = isValidDate(dateEl.value) ? dateEl.value : todayLocal();
  if (base) return base;
  const stem = `post-${date.replace(/-/g, '')}`;
  let candidate = stem;
  let n = 2;
  while (isSlugTaken(candidate)) candidate = `${stem}-${n++}`;
  return candidate;
}

function refreshAutoSlug() {
  if (state.current.mode !== 'new' || state.slugTouched) return;
  const next = autoSlugValue();
  if (next && slugEl.value !== next) slugEl.value = next;
}

function updateSlugNote() {
  slugNote.classList.remove('is-error');
  slugEl.classList.remove('is-invalid');
  if (state.current.mode === 'existing') {
    slugNote.textContent = '编辑已有文章时网址不可修改。';
    return true;
  }
  const slug = readForm().slug;
  let message = '';
  if (!slug) {
    if (state.current.mode === 'new' && isEmptyForm(readForm())) {
      slugNote.textContent = '留空时会根据标题自动生成。';
      return false;
    }
    message = '请填写网址。';
  } else if (!SLUG_PATTERN.test(slug)) message = '只能使用小写字母、数字和连字符，且不能以连字符开头或结尾。';
  else if (RESERVED_SLUGS.has(slug)) message = `“${slug}”是保留网址，请换一个。`;
  else if (isSlugTaken(slug)) message = '这个网址已被其他文章使用。';
  if (message) {
    slugNote.textContent = message;
    slugNote.classList.add('is-error');
    return false;
  }
  slugNote.textContent = `将发布到 /blog/${slug}/`;
  return true;
}

function detectLang(text) {
  const cjk = (String(text).match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latin = (String(text).match(/[A-Za-z]/g) || []).length;
  if (!cjk && !latin) return null;
  return cjk / (cjk + latin) > 0.3 ? 'zh-CN' : 'en';
}

function refreshAutoLang() {
  if (state.current.mode !== 'new' || state.langTouched) return;
  const lang = detectLang(bodyEl.value);
  if (lang && langEl.value !== lang) langEl.value = lang;
}

// ---------------------------------------------------------------- preview

function ensureSiteCss() {
  if (state.cssText) return Promise.resolve();
  if (!state.cssPromise) {
    state.cssPromise = (async () => {
      const response = await fetch('/blog/blog.css', { cache: 'no-store' });
      if (!response.ok) throw new Error(`无法加载 /blog/blog.css（${response.status}）`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      state.cssText = new TextDecoder().decode(bytes);
      state.cssVersion = await sha1Hex(bytes);
    })().catch(() => { state.cssPromise = null; });
  }
  return state.cssPromise;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('无法读取图片数据'));
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const [head, data = ''] = String(dataURL).split(',');
  const mime = /^data:([^;]*)/.exec(head)?.[1] || 'application/octet-stream';
  if (/;base64/i.test(head)) return new Blob([base64ToBytes(data)], { type: mime });
  return new Blob([new TextEncoder().encode(decodeURIComponent(data))], { type: mime });
}

async function inlineExistingImages(html, slug) {
  const base = `${location.origin}/blog/${slug}/`;
  const sources = new Set();
  const imagePattern = /<img\b[^>]*\bsrc="([^"]+)"/gi;
  let match;
  while ((match = imagePattern.exec(html))) {
    const src = match[1];
    if (!src || /^(?:data:|blob:|https?:)/i.test(src)) continue;
    sources.add(src);
  }
  for (const src of sources) {
    let absolute;
    try { absolute = new URL(src, base); } catch { continue; }
    if (absolute.origin !== location.origin) continue;
    let dataURL = state.imageDataCache.get(absolute.href);
    if (!dataURL) {
      try {
        const response = await fetch(absolute.href, { cache: 'no-store' });
        if (!response.ok) continue;
        dataURL = await blobToDataURL(await response.blob());
        state.imageDataCache.set(absolute.href, dataURL);
      } catch {
        continue;
      }
    }
    html = html.split(`src="${src}"`).join(`src="${dataURL}"`);
  }
  return html;
}

async function buildPreviewDocument(html, slug, body) {
  let output = html.replace(/<head>/i, `<head>\n<base href="${location.origin}/blog/${slug}/">`);
  // A sandboxed srcdoc frame has an opaque origin, so 'self' cannot load the stylesheet or
  // same-origin images. Inline the CSS (allowed by 'unsafe-inline') and turn relative images
  // into data URLs; the <base> stays so any URL we could not inline still resolves.
  const css = state.cssText.replace(/<\/style/gi, '<\\/style');
  if (/<link\b[^>]*rel="stylesheet"[^>]*>/i.test(output)) {
    output = output.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/i, `<style>\n${css}\n</style>`);
  } else {
    output = output.replace(/<base[^>]*>/i, match => `${match}\n<style>\n${css}\n</style>`);
  }
  output = output.replace(/<link\b[^>]*rel="(?:icon|alternate)"[^>]*>\s*/gi, '');
  output = output.replace(/<script\b[^>]*><\/script>\s*/gi, ''); // the sandboxed preview runs no scripts
  for (const [name, image] of state.pending) {
    output = output.split(`src="${name}"`).join(`src="${image.dataURL}"`);
  }
  if (body) output = await inlineExistingImages(output, slug);
  return output;
}

function showPreviewDocument(html) {
  // Force a layout pass first. Chromium can leave a sandboxed srcdoc document unlaid-out
  // (an all-white frame) when the iframe was display:none while the document was created.
  previewFrame.getBoundingClientRect();
  previewFrame.srcdoc = html;
}

function previewErrorDocument(message) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <style>
      html { color-scheme: light; }
      body {
        min-height: 100vh;
        margin: 0;
        padding: 22px;
        background: #f7ecea;
        color: #8a3b32;
        font: 14px/1.75 Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
        white-space: pre-wrap;
        overflow-wrap: break-word;
      }
    </style>
  </head>
  <body>${esc(message)}</body>
</html>`;
}

function previewPlaceholderDocument() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <style>
      html { color-scheme: light; }
      body {
        min-height: 100vh;
        margin: 0;
        padding: 22px;
        background: #fafbf8;
        color: #5d6a61;
        font: 14px/1.75 Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      p { margin: 0; }
    </style>
  </head>
  <body><p>开始输入标题和正文，这里会实时显示文章预览。</p></body>
</html>`;
}

async function renderPreview() {
  const run = ++previewRun;
  const form = readForm();
  const meta = metaFrom(form);
  const slug = form.slug || 'preview';
  if (state.current.mode === 'new' && isEmptyForm(form) && state.pending.size === 0) {
    showPreviewDocument(previewPlaceholderDocument());
    previewNote.textContent = '等待输入';
    return;
  }
  try {
    await ensureSiteCss();
    let source = serializePost(meta, form.body);
    let post = readPost(slug, source);
    if (!post) {
      const publishedMeta = { ...meta };
      delete publishedMeta.draft;
      post = readPost(slug, serializePost(publishedMeta, form.body));
    }
    if (!post) throw new PostError('无法渲染预览。');
    const html = renderPost(post, { cssVersion: state.cssVersion || 'preview', year: new Date().getFullYear() });
    const documentText = await buildPreviewDocument(html, slug, form.body);
    if (run !== previewRun) return;
    showPreviewDocument(documentText);
    previewNote.textContent = meta.draft ? '草稿预览（未公开）' : '实时渲染';
  } catch (error) {
    if (run !== previewRun) return;
    const message = error instanceof PostError ? error.message : `预览失败：${error?.message || error}`;
    showPreviewDocument(previewErrorDocument(message));
    previewNote.textContent = '需要修正';
  }
}

function schedulePreview(delay = PREVIEW_DELAY) {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(() => { renderPreview(); }, delay);
}

// ---------------------------------------------------------------- autosave

function autosaveKey() {
  return state.current.mode === 'existing' ? `blog-editor:draft:${state.current.slug}` : NEW_DRAFT_KEY;
}

function readStoredAutosave(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.form) return null;
    return data;
  } catch {
    return null;
  }
}

function removeStoredAutosave(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

function isDirty() {
  if (!state.baseForm) return true;
  return state.pending.size > 0 || !formsEqual(readForm(), state.baseForm);
}

function saveAutosaveNow() {
  if (state.busy) return;
  const key = autosaveKey();
  if (!isDirty()) {
    // Keep an autosave the user has been offered but not decided on; otherwise this copy is
    // identical to the loaded post and only adds noise.
    if (state.savedAutosave?.key !== key) removeStoredAutosave(key);
    return;
  }
  const form = readForm();
  const pending = [...state.pending].map(([name, image]) => ({ name, dataURL: image.dataURL }));
  let payload = { savedAt: Date.now(), form, pending };
  let json = JSON.stringify(payload);
  let omitted = false;
  if (json.length > AUTOSAVE_LIMIT) {
    payload = { savedAt: Date.now(), form, pending: [] };
    json = JSON.stringify(payload);
    omitted = true;
  }
  try {
    localStorage.setItem(key, json);
  } catch {
    try {
      payload = { savedAt: Date.now(), form, pending: [] };
      localStorage.setItem(key, JSON.stringify(payload));
      omitted = true;
    } catch {
      autosaveNote.textContent = '无法自动保存（浏览器存储不可用或已满）';
      return;
    }
  }
  autosaveNote.textContent = `已自动保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}${omitted ? '（图片太大，未包含未发布图片）' : ''}`;
}

function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(saveAutosaveNow, AUTOSAVE_DELAY);
}

function flushAutosave() {
  clearTimeout(state.autosaveTimer);
  if (state.baseForm) saveAutosaveNow();
}

function hideRestoreBanner() {
  restoreBanner.hidden = true;
  state.savedAutosave = null;
}

function checkAutosave(key) {
  const saved = readStoredAutosave(key);
  if (!saved || !saved.form) { hideRestoreBanner(); return; }
  const current = readForm();
  const same = formsEqual(saved.form, current) && !(Array.isArray(saved.pending) && saved.pending.length);
  if (same || (isEmptyForm(saved.form) && !(saved.pending || []).length)) { hideRestoreBanner(); return; }
  state.savedAutosave = { key, saved };
  restoreText.textContent = `发现 ${formatTime(saved.savedAt)} 自动保存的未发布修改`
    + `${saved.pending?.length ? `（含 ${saved.pending.length} 张待上传图片）` : ''}。`;
  restoreBanner.hidden = false;
}

async function restoreAutosave() {
  const stored = state.savedAutosave;
  if (!stored) return;
  const { saved } = stored;
  applyForm(saved.form);
  state.pending.clear();
  for (const item of saved.pending || []) {
    if (!item?.name || !item?.dataURL) continue;
    try {
      const blob = dataURLToBlob(item.dataURL);
      state.pending.set(item.name, { blob, dataURL: item.dataURL });
    } catch {
      // skip an unreadable image
    }
  }
  if (state.current.mode === 'new') {
    state.slugTouched = true;
    state.langTouched = true;
  }
  hideRestoreBanner();
  updatePublishLabel();
  updateSlugNote();
  schedulePreview(0);
  scheduleAutosave();
  showToast('已恢复未发布的修改。');
}

function discardAutosave() {
  if (state.savedAutosave) removeStoredAutosave(state.savedAutosave.key);
  hideRestoreBanner();
  showToast('已放弃自动保存的修改。');
}

// ---------------------------------------------------------------- images

function typeExtension(type) {
  switch (String(type).toLowerCase()) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/svg+xml': return 'svg';
    case 'image/webp': return 'webp';
    case 'image/avif': return 'avif';
    default: return '';
  }
}

function usedImageNumbers() {
  const used = new Set();
  const add = name => {
    const match = /^image-(\d+)\./.exec(name);
    if (match) used.add(Number(match[1]));
  };
  for (const name of state.pending.keys()) add(name);
  const slug = state.current.mode === 'existing' ? state.current.slug : readForm().slug;
  const folder = slug ? `blog/${slug}/` : '';
  if (folder && state.repo?.paths) {
    for (const path of state.repo.paths.keys()) {
      if (path.startsWith(folder)) add(path.slice(folder.length));
    }
  }
  return used;
}

function nextImageName(extension) {
  const used = usedImageNumbers();
  let n = 1;
  while (used.has(n)) n += 1;
  return `image-${n}.${extension}`;
}

async function imageToWebp(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
    return blob && blob.type === 'image/webp' ? blob : null;
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

async function addImageBlob(blob) {
  const type = String(blob.type || '').toLowerCase();
  let output = blob;
  let extension = typeExtension(type);
  if (type === 'image/gif' || type === 'image/svg+xml') {
    extension = type === 'image/gif' ? 'gif' : 'svg';
  } else {
    const webp = await imageToWebp(blob);
    if (webp) {
      output = webp;
      extension = 'webp';
    } else if (type === 'image/png' || type === 'image/jpeg') {
      output = blob;
      extension = type === 'image/png' ? 'png' : 'jpg';
    } else {
      extension = extension || 'png';
    }
  }
  if (!extension) extension = 'png';
  const name = nextImageName(extension);
  const dataURL = await blobToDataURL(output);
  state.pending.set(name, { blob: output, dataURL });
  return name;
}

async function addImageFile(file) {
  try {
    return await addImageBlob(file);
  } catch (error) {
    showToast(`图片处理失败：${error?.message || error}`);
    return null;
  }
}

function insertIntoBody(text) {
  const element = bodyEl;
  element.focus();
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    element.setRangeText(text, start, end, 'end');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  afterBodyEdit();
}

function afterBodyEdit() {
  refreshAutoLang();
  schedulePreview();
  scheduleAutosave();
}

// ---------------------------------------------------------------- paste + drop

function looksLikeMarkdown(text) {
  return /(^|\n)[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]|\d+\.[ \t]|>[ \t]?|```)/.test(text) || String(text).includes('](');
}

function isCodeEditorHtml(documentNode) {
  const candidates = [documentNode.body, ...documentNode.body.querySelectorAll('*')].slice(0, 80);
  for (const element of candidates) {
    const style = (element.getAttribute('style') || '').toLowerCase();
    if (/white-space\s*:\s*pre/.test(style)) return true;
    if (/font-family\s*:[^;]*(?:monospace|mono|consolas|menlo|courier|vscode)/.test(style)) return true;
    const classes = `${element.className || ''} ${element.id || ''}`.toLowerCase();
    if (/(?:monaco|vscode|codemirror|ace_editor|ace-editor)/.test(classes)) return true;
  }
  return false;
}

async function htmlToMarkdown(html, plainText) {
  if (plainText && looksLikeMarkdown(plainText)) return { markdown: plainText, notice: '' };
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  if (isCodeEditorHtml(documentNode)) {
    return { markdown: plainText || documentNode.body.textContent || '', notice: '' };
  }
  let droppedImages = false;
  let remoteImages = 0;
  for (const image of [...documentNode.querySelectorAll('img')]) {
    const src = (image.getAttribute('src') || '').trim();
    if (/^https?:\/\//i.test(src)) {
      image.removeAttribute('srcset');
      remoteImages += 1;
      continue;
    }
    if (/^data:image\//i.test(src)) {
      try {
        const name = await addImageBlob(dataURLToBlob(src));
        image.setAttribute('src', name);
        image.removeAttribute('srcset');
      } catch {
        image.remove();
        droppedImages = true;
      }
      continue;
    }
    image.remove();
    droppedImages = true;
  }
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  turndown.use(gfm);
  let markdown = turndown.turndown(documentNode.body);
  // Turndown pads bullets with three spaces; keep the Markdown compact and predictable.
  markdown = markdown.replace(/^([ \t]*)-[ \t]{2,}/gm, '$1- ').replace(/^([ \t]*)\*[ \t]{2,}/gm, '$1* ');
  const notices = [];
  if (droppedImages) notices.push('部分图片（file: 或 blob:）无法读取，请用「插入图片」单独添加。');
  if (remoteImages) notices.push(`保留了 ${remoteImages} 张网络图片的原链接；原网站若禁止外链（如公众号），发布后可能显示不出来，建议下载后用「插入图片」添加。`);
  return { markdown, notice: notices.join('\n') };
}

async function onPaste(event) {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const start = bodyEl.selectionStart ?? bodyEl.value.length;
  const end = bodyEl.selectionEnd ?? start;

  const html = clipboard.getData('text/html');
  const text = clipboard.getData('text/plain');
  const files = [...(clipboard.items || [])]
    .filter(item => item.kind === 'file' && /^image\//i.test(item.type || ''))
    .map(item => item.getAsFile())
    .filter(Boolean);
  // Word, Excel and some editors put a picture of the copied selection next to its text: only
  // treat the paste as images when no text comes with it (a screenshot, or "Copy image").
  if (files.length && !text.trim()) {
    event.preventDefault();
    const names = [];
    for (const file of files) {
      const name = await addImageFile(file);
      if (name) names.push(name);
    }
    if (names.length) {
      bodyEl.focus();
      bodyEl.setSelectionRange(start, end);
      insertIntoBody(names.map(name => `![](${name})`).join('\n\n'));
    }
    return;
  }

  if (html) {
    event.preventDefault();
    try {
      const { markdown, notice } = await htmlToMarkdown(html, text);
      bodyEl.focus();
      bodyEl.setSelectionRange(start, end);
      insertIntoBody(markdown);
      if (notice) showToast(notice);
    } catch (error) {
      showToast(`无法转换粘贴内容：${error?.message || error}`);
    }
    return;
  }

  if (text !== '') {
    event.preventDefault();
    let output = text;
    let notice = '';
    if (!looksLikeMarkdown(text) && /\r?\n/.test(text) && !/\r?\n[ \t]*\r?\n/.test(text)) {
      output = text.replace(/\r\n|\r|\n/g, '\n\n');
      notice = '已将单换行转换为分段。';
    }
    bodyEl.focus();
    bodyEl.setSelectionRange(start, end);
    insertIntoBody(output);
    if (notice) showToast(notice);
  }
}

async function onDrop(event) {
  const files = [...(event.dataTransfer?.files || [])].filter(file => /^image\//i.test(file.type || ''));
  if (!files.length) return;
  event.preventDefault();
  const start = bodyEl.selectionStart ?? bodyEl.value.length;
  const end = bodyEl.selectionEnd ?? start;
  const names = [];
  for (const file of files) {
    const name = await addImageFile(file);
    if (name) names.push(name);
  }
  if (names.length) {
    bodyEl.focus();
    bodyEl.setSelectionRange(start, end);
    insertIntoBody(names.map(name => `![](${name})`).join('\n\n'));
  }
}

async function onImageFileInput() {
  const files = [...(imageInput.files || [])];
  imageInput.value = '';
  if (!files.length) return;
  const start = bodyEl.selectionStart ?? bodyEl.value.length;
  const end = bodyEl.selectionEnd ?? start;
  const names = [];
  for (const file of files) {
    if (!/^image\//i.test(file.type || '')) continue;
    const name = await addImageFile(file);
    if (name) names.push(name);
  }
  if (names.length) {
    bodyEl.focus();
    bodyEl.setSelectionRange(start, end);
    insertIntoBody(names.map(name => `![](${name})`).join('\n\n'));
  }
}

// ---------------------------------------------------------------- post list

function analyzeSources(sources) {
  return sources.map(({ slug, source }) => {
    let meta = {};
    let draft = false;
    let error = '';
    try {
      meta = parseFrontMatter(source).meta;
    } catch (parseError) {
      error = parseError.message;
    }
    if (!error) {
      try {
        draft = readPost(slug, source) === null;
      } catch (readError) {
        error = readError instanceof PostError ? readError.message : String(readError);
      }
    }
    const title = typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : slug;
    const date = typeof meta.date === 'string' ? meta.date : '';
    return { slug, source, title, date, draft: draft && !error, error, lang: typeof meta.lang === 'string' ? meta.lang : 'en' };
  }).sort((a, b) => {
    if (a.date === b.date) return a.title < b.title ? 1 : -1;
    return a.date < b.date ? 1 : -1;
  });
}

function renderPostList() {
  postListEl.textContent = '';
  for (const post of state.posts) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'post-button';
    if (state.current.mode === 'existing' && state.current.slug === post.slug) button.classList.add('is-active');
    button.dataset.slug = post.slug;
    const name = document.createElement('span');
    name.className = 'post-name';
    name.textContent = post.title;
    const sub = document.createElement('span');
    sub.className = 'post-sub';
    const time = document.createElement('span');
    time.textContent = post.date ? shownDate(post.date) : '无日期';
    sub.append(time);
    if (post.draft) {
      const badge = document.createElement('span');
      badge.className = 'badge draft';
      badge.textContent = '草稿';
      sub.append(badge);
    }
    if (post.error) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '有错误';
      sub.append(badge);
    }
    button.append(name, sub);
    button.addEventListener('click', () => { if (!state.busy) openPost(post.slug); });
    item.append(button);
    postListEl.append(item);
  }
}

async function loadPosts({ quiet = false } = {}) {
  if (!state.gh) return false;
  if (!quiet) {
    listHint.hidden = false;
    listHint.classList.remove('is-error');
    listHint.textContent = '正在读取仓库…';
  }
  try {
    const repo = await state.gh.readState();
    state.repo = repo;
    state.posts = analyzeSources(repo.sources);
    renderPostList();
    listHint.hidden = false;
    listHint.textContent = state.posts.length ? '点击文章即可修改，改完点「保存修改」。' : '还没有文章，直接在右边开始写。';
    if (state.current.mode === 'new' && !state.slugTouched) {
      refreshAutoSlug();
    }
    updateSlugNote();
    return true;
  } catch (error) {
    state.posts = [];
    renderPostList();
    listHint.hidden = false;
    listHint.classList.add('is-error');
    listHint.textContent = describeError(error);
    return false;
  }
}

// ---------------------------------------------------------------- opening posts / new

function populateFromSource(slug, source) {
  const { meta, body } = parseFrontMatter(source);
  const form = {
    title: typeof meta.title === 'string' ? meta.title : '',
    slug,
    date: typeof meta.date === 'string' ? meta.date : '',
    tags: Array.isArray(meta.tags) ? meta.tags.join(', ') : (meta.tags == null ? '' : String(meta.tags)),
    summary: typeof meta.summary === 'string' ? meta.summary : '',
    lang: meta.lang === 'zh-CN' ? 'zh-CN' : 'en',
    draft: meta.draft === true || /^(true|yes)$/i.test(String(meta.draft ?? '')),
    body: String(body).replace(/^\n/, ''),
  };
  applyForm(form);
}

function setSlugReadOnly(readOnly) {
  slugEl.readOnly = readOnly;
}

async function openPost(slug) {
  const entry = state.repo?.sources.find(source => source.slug === slug);
  if (!entry) {
    showToast('找不到这篇文章，请刷新文章列表。');
    return;
  }
  flushAutosave();
  clearTimeout(state.previewTimer);
  try {
    populateFromSource(slug, entry.source);
  } catch (error) {
    showToast(`无法读取这篇文章：${error?.message || error}`);
    return;
  }
  state.current = { mode: 'existing', slug };
  state.pending.clear();
  state.slugTouched = true;
  state.langTouched = true;
  setSlugReadOnly(true);
  deleteButton.hidden = false;
  state.baseForm = readForm();
  hideRestoreBanner();
  checkAutosave(`blog-editor:draft:${slug}`);
  autosaveNote.textContent = '';
  setFormError('');
  setStatus(publishStatus, '');
  updatePublishLabel();
  updateSlugNote();
  renderPostList();
  schedulePreview(0);
}

function resetToNew({ skipRestoreCheck = false, skipFlush = false } = {}) {
  if (!skipFlush) flushAutosave();
  clearTimeout(state.previewTimer);
  state.current = { mode: 'new', slug: '' };
  formEl.reset();
  dateEl.value = todayLocal();
  langEl.value = 'en';
  draftEl.checked = false;
  bodyEl.value = '';
  state.pending.clear();
  state.slugTouched = false;
  state.langTouched = false;
  setSlugReadOnly(false);
  deleteButton.hidden = true;
  state.baseForm = readForm();
  hideRestoreBanner();
  autosaveNote.textContent = '';
  setFormError('');
  setStatus(publishStatus, '');
  updatePublishLabel();
  updateSlugNote();
  renderPostList();
  if (!skipRestoreCheck) checkAutosave(NEW_DRAFT_KEY);
  schedulePreview(0);
}

// ---------------------------------------------------------------- token

function readStoredToken() {
  try {
    const localToken = localStorage.getItem(TOKEN_KEY);
    if (localToken) return { token: localToken, remember: true };
    const sessionToken = sessionStorage.getItem(TOKEN_KEY);
    if (sessionToken) return { token: sessionToken, remember: false };
  } catch {
    // storage can be disabled
  }
  return null;
}

function persistToken(token) {
  try {
    if (rememberToken.checked) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

function forgetToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

function openSettings(open) {
  const next = open ?? settingsEl.hidden;
  settingsEl.hidden = !next;
  settingsToggle.setAttribute('aria-expanded', String(next));
  settingsToggle.textContent = next ? '收起设置' : '设置';
}

async function verifyToken() {
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus(tokenStatus, '请先粘贴 GitHub 令牌。', 'error');
    return false;
  }
  setBusy(true);
  setStatus(tokenStatus, '正在验证令牌…');
  try {
    const gh = new GitHubRepo(token);
    const { canPush } = await gh.verifyPushAccess();
    if (!canPush) {
      state.verified = false;
      state.gh = null;
      state.token = '';
      openSettings(true);
      setStatus(tokenStatus, '令牌可以访问仓库，但没有写入权限。请在令牌的 Permissions → Contents 中选择 Read and write。', 'error');
      return false;
    }
    state.token = token;
    state.gh = gh;
    state.verified = true;
    if (!persistToken(token)) {
      showToast('令牌验证成功，但浏览器不允许保存到本地存储，刷新后需要重新填写。');
    }
    setStatus(tokenStatus, '令牌有效，可以发布。', 'ok');
    const loaded = await loadPosts();
    if (!loaded) setStatus(tokenStatus, '令牌有效，但读取文章列表失败，请检查网络或权限。', 'error');
    else openRequestedPost();
    return true;
  } catch (error) {
    state.verified = false;
    state.gh = null;
    state.token = '';
    openSettings(true);
    setStatus(tokenStatus, describeError(error), 'error');
    return false;
  } finally {
    setBusy(false);
  }
}

function clearToken() {
  forgetToken();
  state.token = '';
  state.verified = false;
  state.gh = null;
  state.repo = null;
  state.posts = [];
  tokenInput.value = '';
  setStatus(tokenStatus, '已清除令牌。', '');
  renderPostList();
  listHint.hidden = false;
  listHint.classList.remove('is-error');
  listHint.textContent = '设置并验证 GitHub 令牌后，这里会列出仓库中的文章。';
}

/** /blog/write/?edit=<slug> (the post pages' Edit link): open that post once the list is loaded. */
function openRequestedPost() {
  const slug = state.requestedEdit;
  if (!slug) return;
  state.requestedEdit = '';
  history.replaceState(history.state, '', location.pathname);
  if (state.repo?.sources.some(source => source.slug === slug)) openPost(slug);
  else showToast(`找不到文章 /blog/${slug}/，可能已被删除。`);
}

// ---------------------------------------------------------------- validation

function validateForm() {
  const form = readForm();
  const errors = [];
  const invalid = new Set();
  if (!form.title.trim()) {
    errors.push('请填写标题。');
    invalid.add('title');
  }
  if (!isValidDate(form.date)) {
    errors.push('请选择有效日期（YYYY-MM-DD）。');
    invalid.add('date');
  }
  if (state.current.mode === 'new') {
    if (!form.slug) {
      errors.push('请填写网址。');
      invalid.add('slug');
    } else if (!SLUG_PATTERN.test(form.slug)) {
      errors.push('网址只能使用小写字母、数字和连字符，且不能以连字符开头或结尾。');
      invalid.add('slug');
    } else if (RESERVED_SLUGS.has(form.slug)) {
      errors.push(`“${form.slug}”是保留网址，请换一个。`);
      invalid.add('slug');
    } else if (isSlugTaken(form.slug)) {
      errors.push(`网址 /blog/${form.slug}/ 已被其他文章使用。`);
      invalid.add('slug');
    }
  }
  titleEl.classList.toggle('is-invalid', invalid.has('title'));
  dateEl.classList.toggle('is-invalid', invalid.has('date'));
  slugEl.classList.toggle('is-invalid', invalid.has('slug'));
  return { form, errors };
}

// ---------------------------------------------------------------- publish

function imageIsReferenced(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\]\\(\\s*(?:\\./)?${escaped}(?:\\s+["'][^"']*["'])?\\s*\\)`).test(body)) return true;
  if (new RegExp(`<img\\b[^>]*\\bsrc=["'](?:\\./)?${escaped}["']`, 'i').test(body)) return true;
  return false;
}

async function publishOnce(form) {
  const gh = state.gh;
  const repo = await gh.readState();
  const wasNew = state.current.mode === 'new';
  if (wasNew && repo.sources.some(source => source.slug === form.slug)) {
    throw new Error(`网址 /blog/${form.slug}/ 已被其他文章使用，请换一个。`);
  }

  const meta = metaFrom(form);
  const title = meta.title;
  const source = serializePost(meta, form.body);
  const sources = repo.sources.filter(item => item.slug !== form.slug);
  sources.push({ slug: form.slug, source });
  const { files, posts, errors } = buildBlog(sources, { cssVersion: repo.cssVersion });
  if (errors.length) throw new Error(errors.join('\n'));

  const treeEntries = [];
  treeEntries.push({ path: `blog/${form.slug}/index.md`, mode: '100644', type: 'blob', content: source });

  for (const [name, image] of state.pending) {
    if (!imageIsReferenced(form.body, name)) continue;
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    const sha = await gh.createBlobFromBytes(bytes);
    treeEntries.push({ path: `blog/${form.slug}/${name}`, mode: '100644', type: 'blob', sha });
  }

  for (const [path, content] of Object.entries(files)) {
    treeEntries.push({ path, mode: '100644', type: 'blob', content });
  }

  // Remove generated pages of drafts and of folders that lost their index.md.
  const publishedSlugs = new Set(posts.map(post => post.slug));
  for (const path of repo.paths.keys()) {
    const match = /^blog\/([^/]+)\/index\.html$/.exec(path);
    if (!match) continue;
    if (RESERVED_SLUGS.has(match[1]) || publishedSlugs.has(match[1])) continue;
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
  }

  const tree = await gh.post(`${REPO_PATH}/git/trees`, { base_tree: repo.treeSha, tree: treeEntries });
  const message = meta.draft
    ? `Save blog draft: ${title}`
    : (wasNew ? `Publish blog post: ${title}` : `Update blog post: ${title}`);
  const commit = await gh.post(`${REPO_PATH}/git/commits`, { message, tree: tree.sha, parents: [repo.head] });
  try {
    await gh.patch(`${REPO_PATH}/git/refs/heads/main`, { sha: commit.sha, force: false });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) return { retry: true };
    throw error;
  }
  return {
    repo,
    files,
    slug: form.slug,
    wasNew,
    draft: Boolean(meta.draft),
    expected: files[`blog/${form.slug}/index.html`] || '',
  };
}

async function waitForDeployment(slug, draft, expected) {
  const deadline = Date.now() + POLL_TIMEOUT;
  do {
    try {
      const response = await fetch(`/blog/${encodeURIComponent(slug)}/?t=${Date.now()}`, { cache: 'no-store' });
      if (draft) {
        if (response.status === 404) return 'ok';
      } else if (response.ok) {
        const text = await response.text();
        if (text === expected) return 'ok';
      }
    } catch {
      // deployment in progress or offline; keep polling
    }
    if (Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL);
  } while (true);
  return 'timeout';
}

async function publish() {
  if (state.busy) return;
  const { form, errors } = validateForm();
  if (errors.length) {
    setFormError(errors.join('\n'));
    return;
  }
  setFormError('');
  if (!state.verified || !state.gh) {
    setStatus(publishStatus, '请先在设置中填写并验证 GitHub 令牌。', 'error');
    openSettings(true);
    return;
  }
  if (state.current.mode === 'existing' && form.slug !== state.current.slug) {
    setFormError('编辑已有文章时不能修改网址。');
    return;
  }

  const wasNew = state.current.mode === 'new';
  const publishKey = autosaveKey();
  clearTimeout(state.autosaveTimer);
  setBusy(true);
  setStatus(publishStatus, '正在提交…');
  try {
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
      const attemptResult = await publishOnce(form);
      if (attemptResult?.retry) {
        setStatus(publishStatus, '主分支已更新，正在重新读取仓库并重试…');
        continue;
      }
      result = attemptResult;
    }
    if (!result) throw new Error('发布失败：重试后仍未成功，请稍后再试。');

    state.current = { mode: 'existing', slug: result.slug };
    slugEl.value = result.slug;
    setSlugReadOnly(true);
    deleteButton.hidden = false;
    state.pending.clear();
    clearTimeout(state.autosaveTimer);
    removeStoredAutosave(publishKey);
    removeStoredAutosave(`blog-editor:draft:${result.slug}`);
    if (wasNew) removeStoredAutosave(NEW_DRAFT_KEY);
    hideRestoreBanner();
    state.baseForm = { ...form };
    autosaveNote.textContent = '';
    setStatus(publishStatus, '已提交，等待 GitHub Pages 部署（约 1 分钟）…');

    const outcome = await waitForDeployment(result.slug, result.draft, result.expected);
    const href = `/blog/${result.slug}/`;
    if (outcome === 'ok') {
      if (result.draft) {
        setStatus(publishStatus, '草稿已保存（未公开）。', 'ok');
      } else {
        setStatus(publishStatus, '已上线：', 'ok', { href, text: href });
      }
    } else if (result.draft) {
      setStatus(publishStatus, '草稿已提交，但 GitHub Pages 部署较慢，稍后会生效。', 'ok');
    } else {
      setStatus(publishStatus, '提交成功，但 GitHub Pages 部署较慢，请稍后访问：', '', { href, text: href });
    }

    await loadPosts({ quiet: true });
    updatePublishLabel();
    updateSlugNote();
  } catch (error) {
    setStatus(publishStatus, describeError(error), 'error');
  } finally {
    setBusy(false);
    if (state.baseForm && isDirty()) scheduleAutosave();
  }
}

// ---------------------------------------------------------------- delete

async function deleteOnce(slug, title) {
  const gh = state.gh;
  const repo = await gh.readState();
  const sources = repo.sources.filter(item => item.slug !== slug);
  const { files, errors } = buildBlog(sources, { cssVersion: repo.cssVersion });
  if (errors.length) throw new Error(errors.join('\n'));

  const treeEntries = [];
  const folder = `blog/${slug}/`;
  for (const path of repo.paths.keys()) {
    if (path === folder.slice(0, -1) || path.startsWith(folder)) {
      treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
    }
  }
  for (const [path, content] of Object.entries(files)) {
    treeEntries.push({ path, mode: '100644', type: 'blob', content });
  }

  const tree = await gh.post(`${REPO_PATH}/git/trees`, { base_tree: repo.treeSha, tree: treeEntries });
  const commit = await gh.post(`${REPO_PATH}/git/commits`, {
    message: `Delete blog post: ${title}`,
    tree: tree.sha,
    parents: [repo.head],
  });
  try {
    await gh.patch(`${REPO_PATH}/git/refs/heads/main`, { sha: commit.sha, force: false });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) return { retry: true };
    throw error;
  }
  return { ok: true };
}

async function waitForGone(slug) {
  const deadline = Date.now() + POLL_TIMEOUT;
  do {
    try {
      const response = await fetch(`/blog/${encodeURIComponent(slug)}/?t=${Date.now()}`, { cache: 'no-store' });
      if (response.status === 404) return 'ok';
    } catch {
      // keep polling
    }
    if (Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL);
  } while (true);
  return 'timeout';
}

async function deletePost() {
  if (state.busy || state.current.mode !== 'existing') return;
  const slug = state.current.slug;
  const listed = state.posts.find(post => post.slug === slug);
  const title = listed?.title || readForm().title.trim() || slug;
  if (!confirm(`确定删除《${title}》吗？\n\n这会从 GitHub 删除 /blog/${slug}/ 下的所有文件（包括图片），且无法撤销。`)) return;

  setBusy(true);
  setStatus(publishStatus, '正在删除…');
  try {
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
      const attemptResult = await deleteOnce(slug, title);
      if (attemptResult?.retry) {
        setStatus(publishStatus, '主分支已更新，正在重新读取仓库并重试…');
        continue;
      }
      result = attemptResult;
    }
    if (!result) throw new Error('删除失败：重试后仍未成功，请稍后再试。');
    setStatus(publishStatus, '已提交，等待 GitHub Pages 部署（约 1 分钟）…');
    const outcome = await waitForGone(slug);
    removeStoredAutosave(`blog-editor:draft:${slug}`);
    resetToNew({ skipRestoreCheck: true, skipFlush: true });
    await loadPosts({ quiet: true });
    if (outcome === 'ok') {
      setStatus(publishStatus, '已删除。', 'ok');
    } else {
      setStatus(publishStatus, '删除已提交，但 GitHub Pages 部署较慢，请稍后再确认。', '');
    }
  } catch (error) {
    setStatus(publishStatus, describeError(error), 'error');
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- events

function onFormChanged(event) {
  const target = event?.target;
  if (target === titleEl) {
    if (state.current.mode === 'new' && !state.slugTouched) {
      refreshAutoSlug();
    }
  } else if (target === dateEl) {
    if (state.current.mode === 'new' && !state.slugTouched && !slugify(titleEl.value)) {
      refreshAutoSlug();
    }
  } else if (target === slugEl) {
    state.slugTouched = true;
  } else if (target === langEl) {
    state.langTouched = true;
  } else if (target === bodyEl) {
    refreshAutoLang();
  } else if (target === draftEl) {
    updatePublishLabel();
  }
  if (target === titleEl) titleEl.classList.remove('is-invalid');
  if (target === dateEl) dateEl.classList.remove('is-invalid');
  if (state.current.mode !== 'existing') updateSlugNote();
  if (!formError.hidden) setFormError('');
  schedulePreview();
  scheduleAutosave();
}

function setupTabs() {
  const tabs = [$('tab-edit'), $('tab-preview')];
  for (const button of tabs) {
    button.addEventListener('click', () => {
      const name = button.dataset.tab;
      for (const other of tabs) {
        const active = other === button;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-selected', String(active));
      }
      document.body.dataset.mobileTab = name;
      if (name === 'preview') schedulePreview(0);
    });
  }
}

function bindEvents() {
  formEl.addEventListener('submit', event => {
    event.preventDefault();
    publish();
  });
  formEl.addEventListener('input', onFormChanged);
  formEl.addEventListener('change', onFormChanged);
  bodyEl.addEventListener('paste', onPaste);
  bodyEl.addEventListener('drop', onDrop);
  bodyEl.addEventListener('dragover', event => {
    if ([...(event.dataTransfer?.types || [])].includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  $('insert-image').addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', onImageFileInput);

  newPostButton.addEventListener('click', () => resetToNew({ skipRestoreCheck: true }));
  deleteButton.addEventListener('click', deletePost);
  settingsToggle.addEventListener('click', () => openSettings());
  verifyButton.addEventListener('click', verifyToken);
  clearTokenButton.addEventListener('click', clearToken);
  rememberToken.addEventListener('change', () => {
    if (state.verified && state.token) persistToken(state.token);
  });
  tokenInput.addEventListener('input', () => {
    if (tokenInput.value.trim() !== state.token) {
      state.verified = false;
      state.gh = null;
      setStatus(tokenStatus, '令牌已修改，请重新点击「验证」。');
    }
  });
  restoreAccept.addEventListener('click', restoreAutosave);
  restoreDiscard.addEventListener('click', discardAutosave);
  window.addEventListener('pagehide', flushAutosave);
}

// ---------------------------------------------------------------- init

async function init() {
  state.requestedEdit = new URLSearchParams(location.search).get('edit') || '';
  dateEl.value = todayLocal();
  state.baseForm = readForm();
  setupTabs();
  bindEvents();
  updatePublishLabel();
  updateSlugNote();
  schedulePreview(0);

  const stored = readStoredToken();
  if (stored) {
    tokenInput.value = stored.token;
    rememberToken.checked = stored.remember;
    checkAutosave(NEW_DRAFT_KEY);
    await verifyToken();
  } else {
    openSettings(true);
    checkAutosave(NEW_DRAFT_KEY);
  }
}

init();
