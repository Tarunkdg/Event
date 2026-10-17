import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("gather-token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function messageFrom(error, fallback = "Something went wrong. Please try again.") {
  if (error?.code === "ERR_NETWORK") {
    return "Unable to reach the Gather API. Make sure the backend is running at http://localhost:5000.";
  }
  return error?.response?.data?.error ?? fallback;
}

export default api;
