import { request } from 'undici';
import { config } from '../../config.js';

export interface GeoResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  osm_url: string;
  importance: number;
}

export const geoProvider = {
  async geocode(name: string, context?: string): Promise<GeoResult[]> {
    if (config.GEO_PROVIDER === 'nominatim') {
      const q = encodeURIComponent(context ? `${name}, ${context}` : name);
      const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&addressdetails=1&limit=5`;
      const { statusCode, body } = await request(url, {
        headers: { 'User-Agent': 'GemmaWebCompanion/1.0' }
      });
      if (statusCode !== 200) return [];
      const data = await body.json() as any[];
      return data.map((d: any) => ({
        name: d.name || name,
        address: d.display_name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        osm_url: `https://www.openstreetmap.org/${d.osm_type}/${d.osm_id}`,
        importance: d.importance || 0
      }));
    }
    return [];
  }
};
