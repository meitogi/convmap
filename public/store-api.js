// The page's data, kept by the local server (SQLite). The hosted page loads
// store-browser.js under this same name instead.

async function call(method, path, body) {
  const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export const listEvents = () => call('GET', 'api/events');
export const createEvent = (input) => call('POST', 'api/events', input);
export const updateEvent = (id, input) => call('PUT', `api/events/${id}`, input);
export const deleteEvent = (id) => call('DELETE', `api/events/${id}`);
export const refetch = () => call('POST', 'api/refetch');
export const listSearches = () => call('GET', 'api/searches');
export const saveSearch = (name, params) => call('POST', 'api/searches', { name, params });
export const deleteSearch = (name) => call('DELETE', `api/searches?name=${encodeURIComponent(name)}`);
