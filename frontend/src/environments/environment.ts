const wsProtocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
const host = typeof window !== 'undefined' ? window.location.host : 'localhost';

export const environment = {
  production: false,
  apiUrl: '/api',
  wsUrl: `${wsProtocol}://${host}/ws`,
};
