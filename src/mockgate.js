// Mock mode can only be switched on from a local machine. Any other host always uses the real API.
export function mockAllowed(hostname, search) {
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  return local && new URLSearchParams(search || '').get('mock') === '1';
}
