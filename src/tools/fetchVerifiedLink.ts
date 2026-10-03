import { searchProvider } from '../providers/search/index.js';
import { isUrlSafe } from '../security/url-policy.js';
import { URL } from 'url';

export async function fetchVerifiedLink({ query }: { query: string }) {
  const results = await searchProvider.search(query);
  
  const safeResults = [];
  for (const r of results) {
    if (await isUrlSafe(r.url)) {
      const hostname = new URL(r.url).hostname;
      const verified = hostname.includes(query.toLowerCase().replace(/\s+/g, ''));
      safeResults.push({ ...r, hostname, verified });
    }
  }

  if (safeResults.length === 0) {
    return { status: "not_found" };
  }

  return { status: "ok", results: safeResults };
}
