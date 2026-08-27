// StorageProvider — the seam between the HLYST engine and wherever
// generated/uploaded audio files actually live. Call sites should import
// `storageProvider` from here, never call @vercel/blob directly.

export interface ClientUploadTokenInput {
  body: unknown;
  request: Request;
  pathname: string;
  allowedContentTypes: string[];
}

export interface StorageProvider {
  readonly name: string;
  isConfigured(): boolean;
  put(path: string, data: Buffer, contentType: string): Promise<string>;
  del(urls: string[]): Promise<void>;
  createClientUploadToken(input: ClientUploadTokenInput): Promise<unknown>;
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

  async del(urls: string[]): Promise<void> {
    if (!urls.length) return;
    const { del } = await import('@vercel/blob');
    await del(urls);
  }

  async createClientUploadToken({ body, request, pathname, allowedContentTypes }: ClientUploadTokenInput): Promise<unknown> {
    const { handleUpload } = await import('@vercel/blob/client');
    return handleUpload({
      body: body as Parameters<typeof handleUpload>[0]['body'],
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes,
        addRandomSuffix: true,
        pathname,
      }),
      onUploadCompleted: async () => {},
    });
  }
}

export const storageProvider: StorageProvider = new VercelBlobStorageProvider();
