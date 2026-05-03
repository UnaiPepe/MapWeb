let worker;
let seq = 0;
const pending = new Map();

export function canUseWorker() {
  return typeof Worker !== "undefined";
}

export function runWorker(type, payload) {
  if (!canUseWorker()) return Promise.reject(new Error("Workers unavailable"));
  if (!worker) {
    worker = new Worker(new URL("./geo-worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", event => {
      const { id, ok, result, error } = event.data || {};
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      ok ? item.resolve(result) : item.reject(new Error(error || "Worker error"));
    });
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}
