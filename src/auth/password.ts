import bcrypt from 'bcryptjs';

const COST = 12;
let dummyHash: string | undefined;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Spend equal time when the account does not exist to avoid user enumeration by timing.
export async function verifyDummy(password: string): Promise<void> {
  dummyHash ??= await bcrypt.hash('geekhub-dummy-password', COST);
  await bcrypt.compare(password, dummyHash);
}
