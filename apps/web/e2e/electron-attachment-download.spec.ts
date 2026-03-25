import { test, expect } from './helpers/fixtures';

test.describe('Electron attachment download flow', () => {
  test('assistant file attachment triggers Electron download API', async ({ mockGateway, page }) => {
    await page.addInitScript(() => {
      (window as any).__downloadCalls = [];
      Object.defineProperty(window, 'electronAPI', {
        configurable: true,
        enumerable: true,
        value: {
          platform: {
            downloadFile: async (input: unknown) => {
              (window as any).__downloadCalls.push(input);
              return { saved: true, path: '/tmp/report.pdf' };
            },
            mediaInfo: async () => ({ fileName: 'report.pdf', size: 1, mimeType: 'application/pdf', extension: '.pdf', modifiedAt: new Date().toISOString() }),
            showcaseList: async () => ({ files: [] }),
            mediaUpload: async () => ({ path: '/tmp/report.pdf' }),
          },
          windowId: 1,
        },
      });
      document.documentElement.classList.add('electron');
    });

    const pageReady = await mockGateway({
      historyMessages: [
        {
          role: 'assistant',
          content: '첨부 파일입니다',
          timestamp: '2024-01-01T00:00:00Z',
          attachments: [
            { fileName: 'report.pdf', mimeType: 'application/pdf', url: 'intelli-claw://%2Ftmp%2Freport.pdf' },
          ],
        },
      ],
    });

    await expect(pageReady.getByText('첨부 파일입니다')).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => {
      return await pageReady.evaluate(() => ({
        hasElectron: 'electronAPI' in window,
        hasDownloadFile: typeof (window as any).electronAPI?.platform?.downloadFile === 'function',
      }));
    }).toEqual({ hasElectron: true, hasDownloadFile: true });

    await pageReady.getByTitle('report.pdf').click();

    await expect.poll(async () => {
      return await pageReady.evaluate(() => (window as any).__downloadCalls.length);
    }).toBe(1);

    const call = await pageReady.evaluate(() => (window as any).__downloadCalls[0]);
    expect(call).toEqual({
      url: 'intelli-claw://%2Ftmp%2Freport.pdf',
      dataUrl: undefined,
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
    });
  });
});
