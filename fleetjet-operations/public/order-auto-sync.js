// One request at a time; automatic checks only run in an active dispatcher session.
export function createOrderAutoSync({getContext, request, now = Date.now, intervalMs = 60000}) {
  let pending = null;
  let sessionKey = '';
  let lastAttempt = -Infinity;
  return {
    async run({manual = false, connectionId = ''} = {}) {
      const context = getContext();
      if (context.role !== 'dispatcher' || !context.token) return null;
      if (pending) return null;
      if (sessionKey !== context.token) { sessionKey = context.token; lastAttempt = -Infinity; }
      if (!manual && (!context.visible || !context.online || !context.connected || context.editing || now() - lastAttempt < intervalMs)) return null;
      lastAttempt = now();
      const token = context.token;
      pending = Promise.resolve().then(() => request({automatic: !manual, connectionId}));
      try {
        const response = await pending;
        // A late result from a signed-out workspace must never replace another workspace.
        return getContext().token === token ? response : null;
      } finally { pending = null; }
    }
  };
}
