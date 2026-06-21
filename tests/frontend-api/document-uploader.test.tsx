import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

import { DocumentUploader } from '../../src/features/knowledge/components/DocumentUploader';
import { renderWithDom, testingLibrary } from './dom-test-helpers';

test('DocumentUploader uploads dropped files and calls success callback', { concurrency: false }, async () => {
  const ragModule = await import('../../src/features/knowledge/api/rag');
  const originalUploadDocument = ragModule.uploadDocument;
  const uploaded: string[] = [];
  const now = Date.now();

  ragModule.uploadDocument = async (file: File) => {
    uploaded.push(file.name);
    return {
      document: {
        id: 'doc-1',
        userId: 'user-1',
        corpusIds: [],
        title: file.name,
        summary: '',
        content: '',
        source: file.name,
        fileType: 'pdf',
        fileSize: file.size,
        status: 'pending',
        tags: [],
        contentHash: null,
        version: 1,
        publishDate: null,
        sourceDept: null,
        securityLevel: null,
        businessCategory: null,
        docLanguage: null,
        parseQuality: null,
        hasOcr: false,
        createdAt: now,
        updatedAt: now,
      },
      job: {
        id: 'job-1',
        userId: 'user-1',
        documentId: 'doc-1',
        jobType: 'index',
        status: 'pending',
        progress: 0,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
      },
    };
  };

  let successCount = 0;

  try {
    const { fireEvent, waitFor } = testingLibrary();
    const view = renderWithDom(React.createElement(DocumentUploader, { onUploadSuccess: () => { successCount += 1; } }));

    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['pdf'], 'sample.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      assert.deepEqual(uploaded, ['sample.pdf']);
      assert.equal(successCount, 1);
    });
  } finally {
    ragModule.uploadDocument = originalUploadDocument;
  }
});
