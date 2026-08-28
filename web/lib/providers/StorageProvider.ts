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

// Local-filesystem storage for the OVH deployment. Files are written under
// public/uploads/ inside the container (mounted from a persistent host
// path in docker-compose.yml — see the `web` service's volumes), so
// Next.js serves them as ordinary static files at SITE_URL + /uploads/...
// with zero custom serving route needed.
//
// No client-direct-upload equivalent: that whole pattern
// (createClientUploadToken / @vercel/blob/client) existed only to route
// around Vercel's 4.5MB serverless body limit, which doesn't apply here.
// Callers upload via a plain server-side multipart POST instead — see
// web/app/api/hlyst-admin/{artist-music,production-music}/upload/route.ts.
export class LocalFilesystemStorageProvider implements StorageProvider {
  readonly name = 'local-filesystem';

  private readonly root = process.env.STORAGE_DIR || '/app/public/uploads';

  isConfigured(): boolean {
    return true;
  }

  private siteUrl(): string {
    return (process.env.SITE_URL || '').replace(/\/$/, '');
  }

  async put(path: string, data: Buffer, contentType: string): Promise<string> {
    const { mkdir, writeFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    void contentType; // filesystem storage doesn't need to record this separately
    const fullPath = join(this.root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return `${this.siteUrl()}/uploads/${path}`;
  }

  async del(urls: string[]): Promise<void> {
    if (!urls.length) return;
    const { unlink } = await import('fs/promises');
    const { join } = await import('path');
    for (const url of urls) {
      try {
        const idx = url.indexOf('/uploads/');
        if (idx === -1) continue;
        const relPath = url.slice(idx + '/uploads/'.length);
        // Reject any path that could escape the storage root.
        if (relPath.includes('..')) continue;
        await unlink(join(this.root, relPath));
      } catch {
        // Already gone or unreachable — proceed; an orphaned DB row
        // getting cleaned up matters more than a missing file erroring out.
      }
    }
  }

  async createClientUploadToken(): Promise<unknown> {
    throw new Error(
      'LocalFilesystemStorageProvider has no client-direct-upload path — use a plain server-side multipart POST instead.'
    );
  }
}

export const storageProvider: StorageProvider = new LocalFilesystemStorageProvider();
