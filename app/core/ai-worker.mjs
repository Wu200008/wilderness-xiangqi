import { chooseMove } from './jieqi-ai.mjs';

// A synchronous CPU search cannot service a queued cancel message. The caller
// cancels immediately by terminating this worker and creates a new one later.
self.addEventListener('message', event => {
  const { id, state, options = {} } = event.data ?? {};
  try {
    const result = chooseMove(state, options);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
