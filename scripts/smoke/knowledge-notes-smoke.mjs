const SERVER_ORIGIN = process.env.KNOWLEDGE_API_ORIGIN || 'http://127.0.0.1:8787';
const DEFAULT_USER_ID = process.env.KNOWLEDGE_USER_ID || '00000000-0000-0000-0000-000000000001';

async function request(path, init = {}) {
  const headers = {
    'x-user-id': DEFAULT_USER_ID,
    ...(init.headers || {}),
  };

  if (init.body !== undefined && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${SERVER_ORIGIN}${path}`, {
    headers,
    ...init,
  });

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? payload.message
        : `HTTP ${response.status}`;
    throw new Error(`${init.method || 'GET'} ${path} failed: ${message}`);
  }

  return payload;
}

async function main() {
  const suffix = Date.now().toString(36);
  const noteTitle = `Smoke Note ${suffix}`;
  const updatedTitle = `Smoke Note Updated ${suffix}`;
  const tagName = `smoke-tag-${suffix}`;

  let createdNoteId = null;
  let createdPresetTagId = null;

  try {
    const createdPresetTag = await request('/api/knowledge/tags/preset', {
      method: 'POST',
      body: JSON.stringify({
        name: tagName,
        color: '#3B82F6',
      }),
    });
    createdPresetTagId = createdPresetTag.id;

    const createdNote = await request('/api/knowledge/notes', {
      method: 'POST',
      body: JSON.stringify({
        title: noteTitle,
        content: '<p>knowledge notes smoke test</p>',
        tags: [tagName, 'smoke'],
      }),
    });
    createdNoteId = createdNote.id;

    const noteList = await request('/api/knowledge/notes');
    const listedNote = Array.isArray(noteList?.items)
      ? noteList.items.find((item) => item.id === createdNoteId)
      : null;
    if (!listedNote || listedNote.title !== noteTitle || !listedNote.tags.includes(tagName)) {
      throw new Error('笔记列表未返回新建记录或标签不正确。');
    }

    const noteDetail = await request(`/api/knowledge/notes/${createdNoteId}`);
    if (noteDetail.title !== noteTitle || !String(noteDetail.content || '').includes('smoke test')) {
      throw new Error('笔记详情读取异常。');
    }

    const updatedNote = await request(`/api/knowledge/notes/${createdNoteId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: updatedTitle,
        content: '<p>knowledge notes smoke test updated</p>',
        tags: [tagName, 'smoke', 'updated'],
      }),
    });
    if (
      updatedNote.title !== updatedTitle ||
      !updatedNote.tags.includes('updated') ||
      !String(updatedNote.content || '').includes('updated')
    ) {
      throw new Error('笔记更新未生效。');
    }

    const searchResult = await request(
      `/api/knowledge/search?query=${encodeURIComponent(updatedTitle)}&limit=10`
    );
    const searchHit = Array.isArray(searchResult?.items)
      ? searchResult.items.find((item) => item.id === createdNoteId)
      : null;
    if (!searchHit || typeof searchHit.score !== 'number') {
      throw new Error('知识笔记搜索未返回预期命中。');
    }

    const tagSearchResult = await request(
      `/api/knowledge/search?tags=${encodeURIComponent(tagName)}&limit=10`
    );
    const tagHit = Array.isArray(tagSearchResult?.items)
      ? tagSearchResult.items.find((item) => item.id === createdNoteId)
      : null;
    if (!tagHit) {
      throw new Error('知识笔记标签过滤搜索未返回预期命中。');
    }

    const allTags = await request('/api/knowledge/tags');
    if (!Array.isArray(allTags?.items) || !allTags.items.includes(tagName)) {
      throw new Error('知识库标签列表未包含新建标签。');
    }

    const metadata = await request('/api/knowledge/metadata');
    if (
      !metadata?.data ||
      !Number.isInteger(metadata.data.noteCount) ||
      !Number.isInteger(metadata.data.presetTagCount)
    ) {
      throw new Error('知识库元数据结构不符合预期。');
    }

    await request(`/api/knowledge/notes/${createdNoteId}`, {
      method: 'DELETE',
    });
    createdNoteId = null;

    await request(`/api/knowledge/tags/preset/${createdPresetTagId}`, {
      method: 'DELETE',
    });
    createdPresetTagId = null;

    console.log(
      JSON.stringify(
        {
          ok: true,
          noteTitle,
          updatedTitle,
          tagName,
          metadata: metadata.data,
        },
        null,
        2
      )
    );
  } finally {
    if (createdNoteId) {
      await request(`/api/knowledge/notes/${createdNoteId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }

    if (createdPresetTagId) {
      await request(`/api/knowledge/tags/preset/${createdPresetTagId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
