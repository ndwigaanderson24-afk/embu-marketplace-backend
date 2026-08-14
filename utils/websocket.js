// utils/websocket.js
// Minimal real-time layer for KenLynk - broadcasts order status changes
// to exactly the people who should see them live: the order's own
// buyer, the order's own seller, and every connected admin. Nothing
// else in the app uses WebSockets yet, so this is deliberately small
// and self-contained rather than a general-purpose pub/sub system.
//
// A client connects to wss://<host>/ws?token=<their JWT>, the same
// token they already use for regular API calls. No token (or an
// invalid one) still connects, but as an anonymous listener - useful
// later if public/broadcast-to-everyone events are ever needed, but
// today it just means they receive nothing targeted.

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

let wss = null;
const userClients = new Map();   // userId -> Set<ws>
const adminClients = new Set();  // Set<ws>

function init(httpServer) {
  wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let decoded = null;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      if (token) decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      // Invalid/expired token - connection stays open as anonymous
      // rather than being rejected outright, matching how a stale
      // token elsewhere in the app just falls back to guest behaviour.
    }

    if (decoded && decoded.role === 'admin') {
      adminClients.add(ws);
      ws.on('close', () => adminClients.delete(ws));
    } else if (decoded && decoded.id) {
      if (!userClients.has(decoded.id)) userClients.set(decoded.id, new Set());
      userClients.get(decoded.id).add(ws);
      ws.on('close', () => {
        const set = userClients.get(decoded.id);
        if (set) { set.delete(ws); if (!set.size) userClients.delete(decoded.id); }
      });
    }

    // A basic heartbeat so dead connections (phone locked, network
    // dropped) get cleaned up instead of silently accumulating.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  console.log('🔌 WebSocket server ready at /ws');
}

function sendToUser(userId, payload) {
  const clients = userClients.get(userId);
  if (!clients) return;
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function sendToAdmins(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of adminClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// The one call order transitions actually use - notifies the order's
// customer, its seller, and every admin in one go, each with the same
// event shape so the frontend handles it identically regardless of
// which dashboard it's showing.
function broadcastOrderUpdate(order, extra = {}) {
  const payload = {
    type: 'order_status_changed',
    orderId: order.id,
    orderNumber: order.order_number,
    status: extra.toStatus || order.status,
    fromStatus: extra.fromStatus,
    timestamp: new Date().toISOString()
  };
  if (order.customer_user_id) sendToUser(order.customer_user_id, payload);
  if (order.seller_id) sendToUser(order.seller_id, payload);
  sendToAdmins(payload);
}

module.exports = { init, sendToUser, sendToAdmins, broadcastOrderUpdate };
