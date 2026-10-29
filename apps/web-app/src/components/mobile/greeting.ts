/**
 * "Good morning, Ana" — the first line of a workspace's Home on a phone.
 *
 * By the WORKSPACE's hour, not the server's (UTC) and not the browser's: a
 * till in Manila opened at 8 in the morning says morning, whichever machine
 * renders it (`.claude/rules/typescript.md`, "Days, times and time zones").
 * The caller passes the hour in, from `zonedHour`, so this reads no clock.
 */
export function greetingFor(hour: number, name: string | null): string {
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  // The first word of a display name: "Ana Reyes" is greeted as Ana. No name, no comma.
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
