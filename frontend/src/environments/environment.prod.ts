export const environment = {
  production: true,
  apiUrl: '/api',
  wsUrl: `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost'}/ws`,
};
