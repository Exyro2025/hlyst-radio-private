// DatabaseProvider — the seam between the HLYST engine and whatever
// Postgres-compatible database actually stores personas, schedule,
// dj_breaks, Talk Wave, and everything else.
//
// HONEST STATE: this interface and its Neon implementation exist and work,
// but the existing API routes still call neon() directly rather than
// through this file — migrating each is separate follow-up work, not
// rushed into this pass. New code should use this from here on.

export interface DatabaseProvider {
  readonly name: string;
  query<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>;
}

export class NeonDatabaseProvider implements DatabaseProvider {
  readonly name = 'neon';
  private client: ReturnType<typeof import('@neondatabase/serverless').neon> | null = null;

  private async getClient() {
    if (!this.client) {
      const { neon } = await import('@neondatabase/serverless');
      const url = process.env.TALKWAVE_URL_POSTGRES_URL;
      if (!url) throw new Error('TALKWAVE_URL_POSTGRES_URL not set.');
      this.client = neon(url);
    }
    return this.client;
  }

  async query<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
    const client = await this.getClient();
    return (client as any)(strings, ...values) as Promise<T[]>;
  }
}

export const databaseProvider: DatabaseProvider = new NeonDatabaseProvider();
