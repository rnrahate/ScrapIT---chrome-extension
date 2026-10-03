import { geoProvider } from '../providers/geo/index.js';

const cache = new Map<string, { exp: number, data: any }>();

export async function lookupLocationMap({ location_name, city_context }: { location_name: string, city_context?: string }) {
  const cacheKey = `${location_name}|${city_context}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.exp > Date.now()) {
    return cached.data;
  }

  const results = await geoProvider.geocode(location_name, city_context);
  
  if (results.length === 0) {
    return { status: "not_found" };
  }

  const top = results[0];
  if (results.length > 1 && top.importance - results[1].importance < 0.1) {
    return { status: "ambiguous", candidates: results.slice(0, 3) };
  }

  if (top.lat < -90 || top.lat > 90 || top.lng < -180 || top.lng > 180) {
    return { status: "error", message: "Invalid coordinate range" };
  }

  const result = {
    status: "ok",
    name: top.name,
    address: top.address,
    lat: top.lat,
    lng: top.lng,
    osm_url: top.osm_url
  };

  cache.set(cacheKey, { exp: Date.now() + 24 * 60 * 60 * 1000, data: result });
  if (cache.size > 1000) {
    const firstKey = cache.keys().next().value;
    if(firstKey) cache.delete(firstKey);
  }

  return result;
}
