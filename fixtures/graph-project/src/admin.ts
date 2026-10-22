import { createUser } from './service';

export function seedUsers(emails: string[]): void {
  for (const email of emails) {
    createUser(email);
  }
}
