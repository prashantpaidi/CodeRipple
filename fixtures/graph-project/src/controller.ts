import { createUser } from './service';

export function register(email: string): boolean {
  return createUser(email);
}
