// Usernames become URL segments (/:owner/:repo), so they must not collide with app routes.
const RESERVED = new Set([
  'login', 'logout', 'signup', 'forgot-password', 'reset-password', 'settings', 'static', 'api',
  'admin', 'new', 'explore', 'search', 'users', 'user', 'repos', 'about', 'help', 'assets',
  'public', 'git', 'dashboard',
]);

const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(value: string): string | null {
  if (!USERNAME_RE.test(value)) {
    return 'Username must be 1-39 characters: letters, digits, or hyphens, starting with a letter or digit.';
  }
  if (RESERVED.has(value.toLowerCase())) return 'That username is reserved.';
  return null;
}

export function validateEmail(value: string): string | null {
  if (value.length > 254 || !EMAIL_RE.test(value)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < 8) return 'Password must be at least 8 characters.';
  // bcrypt ignores input beyond 72 bytes
  if (Buffer.byteLength(value, 'utf8') > 72) return 'Password must be at most 72 bytes.';
  return null;
}

export function validateTokenName(value: string): string | null {
  if (value.length < 1 || value.length > 100) return 'Token name must be 1-100 characters.';
  return null;
}

export function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x1f]/.test(value)) return '/';
  return value;
}
