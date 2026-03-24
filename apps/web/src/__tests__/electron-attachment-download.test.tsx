import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageList } from '@/components/chat/message-list';

const mockBlobDownload = vi.fn();
vi.mock('@/lib/utils/download', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils/download')>('@/lib/utils/download');
  return {
    ...actual,
    blobDownload: (...args: unknown[]) => mockBlobDownload(...args),
  };
});

describe('Electron assistant attachment download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error test injection
    window.electronAPI = {
      platform: {
        downloadFile: vi.fn().mockResolvedValue({ saved: true, path: '/tmp/report.pdf' }),
      },
    };
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete window.electronAPI;
  });

  it('uses Electron download API for assistant file attachments when available', async () => {
    render(
      <MessageList
        messages={[{
          id: 'm1',
          role: 'assistant',
          content: '파일입니다',
          timestamp: new Date().toISOString(),
          toolCalls: [],
          attachments: [{ fileName: 'report.pdf', mimeType: 'application/pdf', downloadUrl: 'intelli-claw://%2Ftmp%2Freport.pdf' }],
        }]}
        loading={false}
        streaming={false}
      />
    );

    fireEvent.click(screen.getByTitle('report.pdf'));

    expect(window.electronAPI.platform.downloadFile).toHaveBeenCalledWith({
      url: 'intelli-claw://%2Ftmp%2Freport.pdf',
      dataUrl: undefined,
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
    });
    expect(mockBlobDownload).not.toHaveBeenCalled();
  });
});

describe('Web fallback download (no electronAPI)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error cleanup
    delete window.electronAPI;
  });

  it('falls back to blobDownload when electronAPI is not available', async () => {
    render(
      <MessageList
        messages={[{
          id: 'm2',
          role: 'assistant',
          content: '파일입니다',
          timestamp: new Date().toISOString(),
          toolCalls: [],
          attachments: [{ fileName: 'data.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', downloadUrl: '/api/media?path=%2Ftmp%2Fdata.xlsx' }],
        }]}
        loading={false}
        streaming={false}
      />
    );

    fireEvent.click(screen.getByTitle('data.xlsx'));

    expect(mockBlobDownload).toHaveBeenCalledWith(
      '/api/media?path=%2Ftmp%2Fdata.xlsx&dl=1',
      'data.xlsx',
    );
  });
});
