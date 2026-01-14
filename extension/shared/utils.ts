export function normalizePageUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove www. prefix from hostname
    const hostname = urlObj.hostname.replace(/^www\./, '');
    // Remove protocol, query params, and hash - just keep hostname + pathname
    const normalized = `${hostname}${urlObj.pathname}`;
    // Remove trailing slash
    return normalized.replace(/\/$/, '') || '/';
  } catch {
    return url;
  }
}

export function isValidPage(urlObj: URL): boolean {
  // Only allow http and https protocols
  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    return false;
  }

  const hostname = urlObj.hostname;
  // Check if hostname is a valid domain name (has at least one dot) - no localhost
  // and not an IP address (no numbers-only pattern) and no colons (IPv6)
  const hasDot = hostname.includes('.');
  const hasNoColons = !hostname.includes(':');
  const isNotIP = !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  
  return hasDot && hasNoColons && isNotIP
}
