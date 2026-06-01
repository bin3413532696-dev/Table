const DEBUGGER_URL = 'http://127.0.0.1:9222/json/list';
const PAGE_ORIGIN = 'http://localhost:3266';
const PAGE_URL_PREFIX = `${PAGE_ORIGIN}/`;
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';
const CSRF_COOKIE_NAME = 'table_dev_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

const cookieJar = new Map();

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
}

function storeCookies(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const cookieHeaders = getSetCookie ? getSetCookie() : [];

  for (const header of cookieHeaders) {
    const [cookiePart] = String(header).split(';');
    const separatorIndex = cookiePart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }

    cookieJar.set(name, value);
  }
}

function buildCookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function ensureCsrfCookie() {
  if (cookieJar.has(CSRF_COOKIE_NAME)) {
    return;
  }

  const response = await fetch(`${PAGE_ORIGIN}/api/knowledge/metadata`, {
    headers: {
      'x-user-id': DEFAULT_USER_ID,
    },
  });

  if (!response.ok) {
    throw new Error(`GET /api/knowledge/metadata failed: HTTP ${response.status}`);
  }

  storeCookies(response);
}

async function requestApi(path, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    await ensureCsrfCookie();
  }

  const headers = {
    'x-user-id': DEFAULT_USER_ID,
    ...(init.headers || {}),
  };

  const cookieHeader = buildCookieHeader();
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const csrfToken = cookieJar.get(CSRF_COOKIE_NAME);
  if (csrfToken && !headers[CSRF_HEADER_NAME] && method !== 'GET') {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }

  if (init.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${PAGE_ORIGIN}${path}`, {
    ...init,
    headers,
  });

  storeCookies(response);

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed: ${payload?.message || response.status}`);
  }
  return payload;
}

async function getPageDebuggerUrl() {
  const targets = await fetchJson(DEBUGGER_URL);
  const pageTarget = targets.find(
    (target) => target.type === 'page' && String(target.url || '').startsWith(PAGE_URL_PREFIX)
  );

  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error('No debugger target found for localhost:3266');
  }

  return pageTarget.webSocketDebuggerUrl;
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.openPromise = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message || 'CDP error'));
        } else {
          resolve(message.result || {});
        }
      }
    });
  }

  async ready() {
    await this.openPromise;
  }

  async send(method, params = {}) {
    await this.ready();
    const id = ++this.id;
    const payload = { id, method, params };

    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.ws.send(JSON.stringify(payload));
    return result;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    }

    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

function toExpression(source) {
  return `(${source})()`;
}

function js(value) {
  return JSON.stringify(value);
}

async function waitFor(cdp, predicateSource, { timeout = 60000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const matched = await cdp.evaluate(toExpression(predicateSource));
    if (matched) {
      return matched;
    }
    await sleep(interval);
  }

  throw new Error(`waitFor timeout after ${timeout}ms`);
}

async function waitForPageReady(cdp) {
  await waitFor(
    cdp,
    `
      () => document.readyState === 'complete' && location.href.includes('localhost:3266')
    `
  );
}

async function clearLocalState(cdp) {
  await cdp.evaluate(
    toExpression(`
      () => {
        localStorage.removeItem('security_pin_hashed');
        localStorage.removeItem('auth_user_id');
        return true;
      }
    `)
  );
}

async function navigateToKnowledge(cdp) {
  await cdp.evaluate(
    toExpression(`
      () => {
        window.location.hash = '#/knowledge';
        return window.location.href;
      }
    `)
  );

  await waitFor(
    cdp,
    `
      () => {
        const text = document.body.innerText || '';
        return location.hash.includes('/knowledge') && text.includes('知识库') && text.includes('新建笔记');
      }
    `
  );
}

async function clickButtonByText(cdp, text) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const button = buttons.find((element) => (element.textContent || '').trim().includes(${js(text)}));
        if (!button) {
          return false;
        }
        button.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error(`Button not found: ${text}`);
  }
}

async function clickPresetColor(cdp, index = 0) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const overlay = Array.from(document.querySelectorAll('div'))
          .find((element) =>
            element.className &&
            String(element.className).includes('fixed inset-0 bg-black/50') &&
            (element.innerText || '').includes('选择标签颜色')
          );
        if (!overlay) {
          return false;
        }

        const buttons = Array.from(overlay.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const colorButtons = buttons.filter((element) => {
          const text = (element.textContent || '').trim();
          return text.length === 0;
        });
        const button = colorButtons[${index}] || colorButtons[0];
        if (!button) {
          return false;
        }
        button.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error('Preset color button not found');
  }
}

async function fillInputByPlaceholder(cdp, placeholder, value) {
  const filled = await cdp.evaluate(
    toExpression(`
      () => {
        const input = Array.from(document.querySelectorAll('input, textarea'))
          .find((element) => element.getAttribute('placeholder') === ${js(placeholder)});
        if (!input) {
          return false;
        }

        const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(input, ${js(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    `)
  );

  if (!filled) {
    throw new Error(`Input not found: ${placeholder}`);
  }
}

async function fillEditorContent(cdp, html) {
  const updated = await cdp.evaluate(
    toExpression(`
      () => {
        const editor = document.querySelector('.ProseMirror');
        if (!editor) {
          return false;
        }

        editor.focus();
        editor.innerHTML = ${js(html)};
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '' }));
        return true;
      }
    `)
  );

  if (!updated) {
    throw new Error('Editor not found');
  }
}

async function clickNoteByTitle(cdp, title) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const cards = Array.from(document.querySelectorAll('h3'))
          .filter((element) => (element.textContent || '').trim() === ${js(title)});
        const titleElement = cards[0];
        const card = titleElement?.closest('.group');
        if (!card) {
          return false;
        }
        card.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error(`Note card not found: ${title}`);
  }
}

async function createPresetTagFromInput(cdp, tagName) {
  await fillInputByPlaceholder(cdp, '添加标签...', tagName);
  await clickButtonByText(cdp, `创建预设标签 "${tagName}"`);
  await waitFor(
    cdp,
    `
      () => (document.body.innerText || '').includes('选择标签颜色')
    `
  );
  await clickPresetColor(cdp, 0);
  await waitFor(
    cdp,
    `
      () => {
        const tags = Array.from(document.querySelectorAll('span'))
          .map((element) => (element.textContent || '').trim());
        return tags.includes(${js(tagName)});
      }
    `,
    { timeout: 30000 }
  );
}

async function waitForFeedback(cdp, text) {
  await waitFor(
    cdp,
    `
      () => (document.body.innerText || '').includes(${js(text)})
    `,
    { timeout: 30000 }
  );
}

async function withDialogConfirm(cdp, matcherText) {
  await cdp.evaluate(
    toExpression(`
      () => {
        window.__confirmCalls = window.__confirmCalls || [];
        window.confirm = (message) => {
          window.__confirmCalls.push(message);
          return true;
        };
        return true;
      }
    `)
  );

  await clickButtonByText(cdp, matcherText);
}

async function clickEditDeleteButton(cdp) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const target = buttons.find((button) =>
          button.className.includes('text-red-500') &&
          button.querySelector('svg')
        );
        if (!target) {
          return false;
        }
        target.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error('Edit delete button not found');
  }
}

async function clickPresetTagDeleteButton(cdp, tagName) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const labels = Array.from(document.querySelectorAll('span'))
          .filter((element) => (element.textContent || '').trim() === ${js(tagName)});
        const label = labels[0];
        const row = label?.closest('div.flex.items-center.justify-between.p-3.border.rounded-lg');
        const target = row?.querySelector('button');
        if (!target) {
          return false;
        }
        target.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error(`Preset tag delete button not found: ${tagName}`);
  }
}

async function openSettings(cdp) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const target = buttons.find((button) => {
          const text = (button.textContent || '').trim();
          const hasSettingsIcon = button.querySelector('svg');
          return text === '' && hasSettingsIcon && button.className.includes('text-gray-500');
        });
        if (!target) {
          return false;
        }
        target.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error('Settings button not found');
  }
}

async function readStats(cdp) {
  return cdp.evaluate(
    toExpression(`
      () => {
        const text = document.body.innerText || '';
        return text;
      }
    `)
  );
}

async function main() {
  const suffix = Date.now().toString(36);
  const noteTitle = `E2E 笔记 ${suffix}`;
  const noteTitleUpdated = `E2E 笔记已更新 ${suffix}`;
  const tagName = `e2e-tag-${suffix}`;
  const summary = {
    pageUrl: null,
    tests: [],
    failures: [],
    cleanup: [],
  };

  let createdNoteId = null;
  let createdPresetTagId = null;
  const wsUrl = await getPageDebuggerUrl();
  const cdp = new CDPClient(wsUrl);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitForPageReady(cdp);
    await clearLocalState(cdp);
    await cdp.send('Page.reload');
    await waitForPageReady(cdp);
    await navigateToKnowledge(cdp);
    summary.pageUrl = await cdp.evaluate('location.href');

    await clickButtonByText(cdp, '新建笔记');
    await waitFor(
      cdp,
      `
        () => {
          const input = document.querySelector('input[placeholder="笔记标题"]');
          return Boolean(input);
        }
      `
    );
    await fillInputByPlaceholder(cdp, '笔记标题', noteTitle);
    await createPresetTagFromInput(cdp, tagName);
    await fillEditorContent(cdp, `<p>初始内容 ${suffix}</p>`);
    await clickButtonByText(cdp, '保存');
    await waitForFeedback(cdp, '笔记已创建');

    const notesPayload = await requestApi('/api/knowledge/notes');
    const createdNote = Array.isArray(notesPayload?.items)
      ? notesPayload.items.find((item) => item.title === noteTitle)
      : null;
    createdNoteId = createdNote?.id || null;
    summary.tests.push({
      test: 'create_note',
      persisted: Boolean(createdNote),
      hasTag: createdNote?.tags?.includes(tagName) || false,
    });
    if (!createdNote) {
      throw new Error('Created note not found in backend');
    }

    const tagsPayload = await requestApi('/api/knowledge/tags/preset');
    const createdTag = Array.isArray(tagsPayload?.items)
      ? tagsPayload.items.find((item) => item.name === tagName)
      : null;
    createdPresetTagId = createdTag?.id || null;
    summary.tests.push({
      test: 'create_preset_tag',
      persisted: Boolean(createdTag),
      hasColor: typeof createdTag?.color === 'string' && createdTag.color.length > 0,
    });
    if (!createdTag) {
      throw new Error('Created preset tag not found in backend');
    }

    await clickNoteByTitle(cdp, noteTitle);
    await waitFor(
      cdp,
      `
        () => {
          const input = document.querySelector('input[placeholder="笔记标题"]');
          return Boolean(input) && input.value === ${js(noteTitle)};
        }
      `
    );
    await fillInputByPlaceholder(cdp, '笔记标题', noteTitleUpdated);
    await fillEditorContent(cdp, `<p>更新后内容 ${suffix}</p>`);
    await clickButtonByText(cdp, '保存');
    await waitForFeedback(cdp, '笔记已更新');

    const updatedNoteEnvelope = await requestApi(`/api/knowledge/notes/${createdNote.id}`);
    const updatedNote = updatedNoteEnvelope?.data;
    summary.tests.push({
      test: 'update_note',
      titleUpdated: updatedNote?.title === noteTitleUpdated,
      contentUpdated: String(updatedNote?.content || '').includes(`更新后内容 ${suffix}`),
    });
    if (updatedNote?.title !== noteTitleUpdated) {
      throw new Error('Updated note title mismatch');
    }

    await clickNoteByTitle(cdp, noteTitleUpdated);
    await cdp.evaluate(
      toExpression(`
        () => {
          window.confirm = () => true;
          return true;
        }
      `)
    );
    await clickEditDeleteButton(cdp);
    await waitForFeedback(cdp, '笔记已删除');
    const deletedNoteEnvelope = await requestApi(`/api/knowledge/notes/${createdNote.id}`).catch(() => null);
    const deletedNote = deletedNoteEnvelope?.data ?? null;
    summary.tests.push({
      test: 'delete_note',
      removed: deletedNote === null,
    });
    createdNoteId = null;

    await openSettings(cdp);
    await waitFor(
      cdp,
      `
        () => (document.body.innerText || '').includes('预设标签管理')
      `
    );
    await cdp.evaluate(
      toExpression(`
        () => {
          window.confirm = () => true;
          return true;
        }
      `)
    );
    await clickPresetTagDeleteButton(cdp, tagName);
    await waitFor(
      cdp,
      `
        () => !(document.body.innerText || '').includes(${js(tagName)})
      `,
      { timeout: 30000 }
    );
    const tagsAfterDelete = await requestApi('/api/knowledge/tags/preset');
    const tagStillExists = Array.isArray(tagsAfterDelete?.items)
      ? tagsAfterDelete.items.some((item) => item.id === createdTag.id)
      : false;
    summary.tests.push({
      test: 'delete_preset_tag',
      removed: !tagStillExists,
    });
    createdPresetTagId = null;

    const statsText = await readStats(cdp);
    summary.tests.push({
      test: 'settings_stats_visible',
      visible: statsText.includes('知识笔记') && statsText.includes('预设标签'),
    });
  } finally {
    if (createdNoteId) {
      try {
        await requestApi(`/api/knowledge/notes/${createdNoteId}`, { method: 'DELETE' });
        summary.cleanup.push(`deleted note ${createdNoteId}`);
      } catch (error) {
        summary.failures.push(`cleanup_note: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (createdPresetTagId) {
      try {
        await requestApi(`/api/knowledge/tags/preset/${createdPresetTagId}`, { method: 'DELETE' });
        summary.cleanup.push(`deleted preset tag ${createdPresetTagId}`);
      } catch (error) {
        summary.failures.push(`cleanup_tag: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      await clearLocalState(cdp);
    } catch {
      // ignore cleanup failures
    }

    cdp.close();
  }

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.failures.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
