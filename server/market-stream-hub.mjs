// Shared in-process polling for Server-Sent Events. One upstream snapshot is fetched
// per ticker/interval channel and fanned out to all connected listeners.
export function createMarketStreamHub({
  loadSnapshot,
  pollMs = 5000,
  heartbeatMs = 15000,
  signature = value => JSON.stringify(value)
} = {}) {
  if (typeof loadSnapshot !== 'function') throw new TypeError('loadSnapshot must be a function');
  const groups = new Map();
  const interval = Math.max(1000, Number(pollMs) || 5000);
  const heartbeat = Math.max(1000, Number(heartbeatMs) || 15000);

  function notify(group, method, value) {
    for (const listener of [...group.listeners]) {
      try { listener?.[method]?.(value); } catch {}
    }
  }

  function createGroup(key) {
    const group = { key, listeners: new Set(), inFlight: false, seq: 0, lastSignature: null, pollTimer: null, heartbeatTimer: null };
    groups.set(key, group);

    const poll = async () => {
      if (groups.get(key) !== group || group.listeners.size === 0 || group.inFlight) return;
      group.inFlight = true;
      try {
        const value = await loadSnapshot(key);
        if (groups.get(key) !== group || group.listeners.size === 0) return;
        const nextSignature = signature(value);
        if (nextSignature !== group.lastSignature) {
          group.lastSignature = nextSignature;
          const payload = { ...value, seq: ++group.seq };
          notify(group, 'onData', payload);
        }
      } catch (error) {
        if (groups.get(key) === group) notify(group, 'onError', error);
      } finally {
        group.inFlight = false;
      }
    };

    group.pollNow = poll;
    group.pollTimer = setInterval(() => { void poll(); }, interval);
    group.heartbeatTimer = setInterval(() => notify(group, 'onHeartbeat', Date.now()), heartbeat);
    void poll();
    return group;
  }

  function subscribe(key, listener) {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) throw new TypeError('stream key is required');
    if (!listener || typeof listener !== 'object') throw new TypeError('listener must be an object');
    const group = groups.get(normalizedKey) || createGroup(normalizedKey);
    group.listeners.add(listener);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      group.listeners.delete(listener);
      if (group.listeners.size === 0 && groups.get(normalizedKey) === group) {
        clearInterval(group.pollTimer);
        clearInterval(group.heartbeatTimer);
        groups.delete(normalizedKey);
      }
    };
  }

  function stats() {
    return {
      channels: groups.size,
      subscribers: [...groups.values()].reduce((total, group) => total + group.listeners.size, 0),
      polling: [...groups.values()].filter(group => group.inFlight).length
    };
  }

  return { subscribe, stats };
}
