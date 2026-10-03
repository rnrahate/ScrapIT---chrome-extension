import { request } from 'undici';
import { config } from '../../config.js';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export const searchProvider = {
  async search(query: string): Promise<SearchResult[]> {
    if (config.SEARCH_PROVIDER === 'brave') {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
      const { statusCode, body } = await request(url, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': config.SEARCH_API_KEY || ''
        }
      });
      if (statusCode !== 200) return [];
      const data = await body.json() as any;
      return (data.web?.results || []).slice(0, 5).map((r: any) => ({
        title: r.title,
        url: r.url,
        description: r.description
      }));
    }
    return [];
  }
};
