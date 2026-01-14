export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
export const WS_BASE_URL = API_BASE_URL.replace("http", "ws");

const REDIRECT_URI = "https://" + chrome.runtime.id + ".chromiumapp.org/";

export const GOOGLE_AUTH_CONFIG = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  redirectUri: REDIRECT_URI,
  scope: 'openid email',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth'
};

export const GITHUB_AUTH_CONFIG = {
  clientId: import.meta.env.VITE_GITHUB_CLIENT_ID,
  redirectUri: REDIRECT_URI,
  scope: '',
  authUrl: 'https://github.com/login/oauth/authorize'
};