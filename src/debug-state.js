import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
const events = [];
export function withDebugContext(details, task) { return context.run(details, task); }
export function recordDebugEvent(message) {
  const details = context.getStore();
  if (!details) return;
  const safeMessage = String(message).replace(/https?:\/\/\S+/g, '[URL omitida]')
    .replace(/(password|token|secret|authorization|cookie)\s*[:=]\s*\S+/gi, '$1=[oculto]').slice(0, 1000);
  events.push({ at: new Date().toISOString(), email: details.email, query: details.query, source: details.source, message: safeMessage });
  if (events.length > 200) events.shift();
}
export function getDebugEvents(email = '') {
  return events.filter((event) => !email || event.email?.toLowerCase() === email).slice(-100).reverse().map((event) => ({ ...event }));
}
