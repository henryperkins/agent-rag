import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE ?? __API_BASE__) as string;

export const apiClient = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});
