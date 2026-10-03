import { URL } from 'url';
import dns from 'dns/promises';
import ipaddr from 'ipaddr.js';

async function test(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:') return {r: false, v: 'prot'};
    const hostname = parsed.hostname;
    
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return {r: false, v: 'loc'};

    if (ipaddr.isValid(hostname)) {
       const ip = ipaddr.parse(hostname);
       if (ip.range() !== 'unicast') return {r: false, v: 'ip range'};
    }
    
    const addresses = await dns.resolve(hostname);
    for (const address of addresses) {
       const ip = ipaddr.parse(address);
       if (ip.range() !== 'unicast') return {r: false, v: 'dns ip range ' + ip.range() + ' ' + address};
    }
    
    return true;
  } catch (e) {
    return {r: false, v: 'catch ' + e.message};
  }
}

test('https://example.com/').then(console.log);
