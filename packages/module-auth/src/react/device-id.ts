'use client';

import { AUTH_DEVICE_COOKIE, isAuthDeviceId } from '../domain/display.js';

/**
 * This browser's device id (`AUTH_DEVICE_COOKIE`), which the web app's proxy
 * issues on the first page load — or null before it has, or where cookies are
 * refused. Null is a working answer: the settings then read and change the
 * account's own sizes, as before devices.
 *
 * Readable by the page on purpose (the cookie is not httpOnly): it is not a
 * credential and proves nothing, and the settings pages must name it to the
 * API, which never sees the web app's cookies.
 */
export function readDeviceId(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== AUTH_DEVICE_COOKIE) continue;
    const value = decodeURIComponent(rest.join('='));
    return isAuthDeviceId(value) ? value : null;
  }
  return null;
}
