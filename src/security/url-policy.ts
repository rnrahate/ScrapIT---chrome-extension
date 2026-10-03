import { URL } from 'url';
import dns from 'dns/promises';
import ipaddr from 'ipaddr.js';

export async function isUrlSafe(targetUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:') return false;
    
    const hostname = parsed.hostname;
    
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;

    if (ipaddr.isValid(hostname)) {
       const ip = ipaddr.parse(hostname);
       if (ip.range() !== 'unicast') return false; 
       if (ip.kind() === 'ipv4' && (ip.range() === 'private' || ip.range() === 'loopback' || ip.range() === 'linkLocal')) {
           return false;
       }
    }
    
    const addresses = await dns.resolve(hostname);
    for (const address of addresses) {
       const ip = ipaddr.parse(address);
       if (ip.range() !== 'unicast') return false;
       if (ip.kind() === 'ipv4' && (ip.range() === 'private' || ip.range() === 'loopback' || ip.range() === 'linkLocal')) {
           return false;
       }
    }
    
    return true;
  } catch (e) {
    return false;
  }
}
