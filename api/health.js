import { sendJson, handleOptions } from '../src/http.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  sendJson(res, 200, { ok: true, live: true, service: 'googleplayoss', time: new Date().toISOString() });
}
