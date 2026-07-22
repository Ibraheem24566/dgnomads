const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:3002").replace(/\/$/, "");

function authHeader() {
  const creds = localStorage.getItem("adtracker_creds");
  return creds ? { Authorization: `Basic ${creds}` } : {};
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    localStorage.removeItem("adtracker_creds");
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function saveCredentials(user, password) {
  localStorage.setItem("adtracker_creds", btoa(`${user}:${password}`));
}

export function clearCredentials() {
  localStorage.removeItem("adtracker_creds");
}

export function hasCredentials() {
  return !!localStorage.getItem("adtracker_creds");
}

export function getLeads(filters = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  return request(`/api/leads?${params.toString()}`);
}

export function updateLead(id, fields) {
  return request(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
}

export function getPerformance(params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return request(`/api/performance?${qs.toString()}`);
}

export function getCampaigns() {
  return request("/api/campaigns");
}

export function getOverview(days = 7) {
  return request(`/api/overview?days=${days}`);
}
