// Minimal GitHub REST client for the in-browser blog editor.
// The token is only ever sent to https://api.github.com (see the page's CSP).
import { RESERVED_SLUGS } from '../lib/blog-core.mjs';

export const OWNER = 'Hydrofoooil';
export const REPO = 'Hydrofoooil.github.io';
export const BRANCH = 'main';
export const API = 'https://api.github.com';
export const REPO_PATH = `/repos/${OWNER}/${REPO}`;

const HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export class GitHubError extends Error {
  constructor(message, { status = 0, apiMessage = '', path = '' } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.apiMessage = apiMessage;
    this.path = path;
  }
}

/** Chinese-friendly description of an API or network failure. */
export function describeError(error) {
  if (!(error instanceof GitHubError)) return error?.message ? String(error.message) : String(error);
  if (!error.status) return error.message || '网络错误：无法连接 GitHub API。';
  if (error.status === 401) return '令牌无效或已过期（401），请重新生成并填写。';
  if (error.status === 403) {
    return `权限不足（403）：请确认令牌选择了 Hydrofoooil.github.io，并授予 Contents 读写权限${error.apiMessage ? `（${error.apiMessage}）` : '。'}`;
  }
  if (error.status === 404) {
    return `权限不足（404）：令牌无权访问 ${OWNER}/${REPO}，或仓库不存在${error.apiMessage ? `（${error.apiMessage}）` : '。'}`;
  }
  if (error.status === 422) {
    return `GitHub 拒绝了请求（422）：${error.apiMessage || '主分支可能已更新，或提交数据无效。'}`;
  }
  return `GitHub API 错误（${error.status}）：${error.apiMessage || error.message}`;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(String(text).replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** First 8 hex characters of SHA-1(bytes), the same cssVersion scripts/build_blog.mjs uses. */
export async function sha1Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('浏览器不支持 Web Crypto，无法计算 CSS 版本。请使用现代浏览器。');
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 8);
}

export class GitHubRepo {
  constructor(token) {
    this.token = token;
    this.blobCache = new Map(); // blob sha -> Uint8Array
  }

  async request(method, path, body) {
    const url = path.startsWith('http') ? path : API + path;
    const init = {
      method,
      cache: 'no-store',
      headers: { ...HEADERS, Authorization: `Bearer ${this.token}` },
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new GitHubError('网络错误：无法连接 GitHub API，请检查网络后重试。', { path });
    }
    if (!response.ok) {
      let apiMessage = '';
      let apiErrors = '';
      try {
        const data = await response.json();
        apiMessage = typeof data?.message === 'string' ? data.message : '';
        if (Array.isArray(data?.errors)) apiErrors = data.errors.map(item => item.message || item.code || '').filter(Boolean).join('；');
      } catch {
        // keep the status text
      }
      throw new GitHubError(apiMessage || response.statusText || 'GitHub API 请求失败', {
        status: response.status,
        apiMessage: [apiMessage, apiErrors].filter(Boolean).join('：'),
        path,
      });
    }
    if (response.status === 204) return null;
    return response.json();
  }

  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  patch(path, body) { return this.request('PATCH', path, body); }

  /** GET /repos/{owner}/{repo} — used to verify that the token can push. */
  async verifyPushAccess() {
    const data = await this.get(REPO_PATH);
    return { data, canPush: data?.permissions?.push === true };
  }

  async blob(sha) {
    if (this.blobCache.has(sha)) return this.blobCache.get(sha);
    const data = await this.get(`${REPO_PATH}/git/blobs/${sha}`);
    if (data?.encoding !== 'base64' || typeof data?.content !== 'string') {
      throw new GitHubError('无法读取仓库文件（GitHub 返回了未知的编码）。', { status: 0 });
    }
    const bytes = base64ToBytes(data.content);
    this.blobCache.set(sha, bytes);
    return bytes;
  }

  async createBlobFromBytes(bytes) {
    const data = await this.post(`${REPO_PATH}/git/blobs`, { content: bytesToBase64(bytes), encoding: 'base64' });
    return data.sha;
  }

  /**
   * Read the current state of main: ref -> commit -> tree -> every post's index.md and blog.css.
   * Returns { head, treeSha, paths: Map<path, entry>, sources: [{slug, source, sha}], cssVersion }.
   */
  async readState() {
    const ref = await this.get(`${REPO_PATH}/git/ref/heads/${BRANCH}`);
    const head = ref?.object?.sha;
    if (!head) throw new GitHubError('无法读取 main 分支的最新提交。', { status: 0 });
    const commit = await this.get(`${REPO_PATH}/git/commits/${head}`);
    const treeSha = commit?.tree?.sha;
    if (!treeSha) throw new GitHubError('无法读取 main 分支的目录树。', { status: 0 });
    const tree = await this.get(`${REPO_PATH}/git/trees/${treeSha}?recursive=1`);
    if (tree?.truncated) {
      throw new GitHubError('仓库文件太多，GitHub 的目录接口返回被截断，为避免丢失文件已停止操作。', { status: 0 });
    }
    const paths = new Map();
    for (const entry of tree?.tree || []) {
      if (entry.type === 'blob') paths.set(entry.path, entry);
    }

    const sources = [];
    const walk = [...paths];
    for (const [path, entry] of walk) {
      const match = /^blog\/([^/]+)\/index\.md$/.exec(path);
      if (!match) continue;
      const slug = match[1];
      if (RESERVED_SLUGS.has(slug)) continue;
      const bytes = await this.blob(entry.sha);
      sources.push({ slug, source: new TextDecoder().decode(bytes), sha: entry.sha });
    }

    let cssVersion = '';
    const cssEntry = paths.get('blog/blog.css');
    if (cssEntry) cssVersion = await sha1Hex(await this.blob(cssEntry.sha));

    return { head, treeSha, paths, sources, cssVersion };
  }
}
