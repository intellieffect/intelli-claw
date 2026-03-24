import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from '@/components/chat/message-list';

// Regression test for #282
// Assistant file attachment must remain visible when content is the placeholder-only form.
describe('#282 attachment persistence', () => {
  it('renders assistant file card even when content is attachment placeholder text', () => {
    render(
      <MessageList
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            content: '(첨부 파일)',
            timestamp: new Date().toISOString(),
            toolCalls: [],
            attachments: [
              {
                fileName: 'report.pdf',
                mimeType: 'application/pdf',
                downloadUrl: 'intelli-claw://%2FUsers%2Fbigno%2FDownloads%2Freport.pdf',
              },
            ],
          },
        ]}
        loading={false}
        streaming={false}
      />,
    );

    expect(screen.getByTitle('report.pdf')).toBeInTheDocument();
  });
});
