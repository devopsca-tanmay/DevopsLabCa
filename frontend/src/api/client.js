import axios from 'axios';

// VITE_API_URL is baked in at BUILD time (Vite inlines import.meta.env).
// It defaults to the relative path "/api" because in every deployed
// configuration the browser talks to nginx on the same origin, and nginx
// proxies /api to the backend container. That is why the frontend image needs
// no backend hostname and is identical in every environment.
const baseURL = import.meta.env.VITE_API_URL || '/api';

const client = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

const TOKEN_KEY = 'fintrack_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Attach the JWT to every outgoing request.
client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 means the token is missing, forged or expired - drop it and send the
// user back to the login screen rather than leaving the UI in a broken state.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      setToken(null);
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

/** Normalises an axios error into a message the UI can display. */
export function errorMessage(error, fallback = 'Something went wrong') {
  const data = error && error.response && error.response.data;
  if (data) {
    if (Array.isArray(data.details) && data.details.length) return data.details.join('. ');
    if (data.error) return data.error;
  }
  if (error && error.code === 'ECONNABORTED') return 'The request timed out';
  return fallback;
}

export default client;
