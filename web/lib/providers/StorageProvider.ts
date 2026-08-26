// StorageProvider — the seam between the HLYST engine and wherever
// generated audio files actually live. Call sites should import
// `storageProvider` from here, never call @vercel/blob directly.

export interface StorageProvider {
  readonly name: string;
  isConfigured(): boolean;
  put(path: string, data: Buffer, contentType: string): Promise<string>;
}

export class VercelBlobStorageProvider implements StorageProvider {
  readonly name = 'vercel-blob';

  isConfigured(): boolean {
    return true;
  }

  async put(path: string, data: Buffer, contentType: string): Promise<string> {
    const { put } = await import('@vercel/blob');
    const blob = await put(path, data, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    });
    return blob.url;
  }
}

export const storageProvider: StorageProvider = new VercelBlobStorageProvider();
