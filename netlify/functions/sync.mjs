// Netlify Function: enkel synk av hela datamängden via Netlify Blobs.
// GET  /api/sync  -> returnerar sparad JSON (eller null)
// PUT  /api/sync  -> sparar JSON-kroppen
// Skyddas av miljövariabeln SYNC_TOKEN (Site configuration → Environment variables).
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const token = process.env.SYNC_TOKEN;
  const auth = req.headers.get('authorization') || '';
  if (!token || auth !== `Bearer ${token}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const store = getStore('tidrapport');
  if (req.method === 'GET') {
    const data = await store.get('data', { type: 'json' });
    return Response.json(data ?? null, { headers: { 'cache-control': 'no-store' } });
  }
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    if (!body || typeof body !== 'object' || !Array.isArray(body.entries)) return new Response('Unexpected payload', { status: 400 });
    await store.setJSON('data', body);
    return Response.json({ ok: true, savedAt: new Date().toISOString() });
  }
  return new Response('Method not allowed', { status: 405 });
};

export const config = { path: '/api/sync' };
