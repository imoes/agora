const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

export const environment = {
  production: false,
  apiUrl: `http://${hostname}:8000/api`,
  wsUrl: `ws://${hostname}:8000/ws`,
};
