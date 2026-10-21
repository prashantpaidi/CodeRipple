export interface User {
  email: string;
  name: string;
}

export class UserRepository {
  private readonly users = new Map<string, User>();

  save(user: User): void {
    this.users.set(user.email, user);
  }

  findByEmail(email: string): User | undefined {
    return this.users.get(email);
  }

  count(): number {
    return this.users.size;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
