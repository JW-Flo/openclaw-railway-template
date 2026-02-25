import { writable } from 'svelte/store';

export const notifications = writable([]);

let nextId = 0;

export function notify(type, message, duration = 5000) {
  const id = ++nextId;
  notifications.update(n => [...n, { id, type, message }]);
  if (duration > 0) {
    setTimeout(() => dismiss(id), duration);
  }
  return id;
}

export function dismiss(id) {
  notifications.update(n => n.filter(item => item.id !== id));
}

export function success(message) { return notify('success', message); }
export function error(message) { return notify('error', message, 8000); }
export function info(message) { return notify('info', message); }
