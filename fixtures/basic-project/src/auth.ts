import { UserRepository, normalizeEmail, type User } from './user';

export class AuthService {
  constructor(private readonly repository: UserRepository) {}

  login(email: string, password: string): boolean {
    const normalized = normalizeEmail(email);
    const user = this.repository.findByEmail(normalized);
    if (user === undefined || password.length === 0) {
      return false;
    }
    this.recordLogin(user);
    return true;
  }

  private recordLogin(user: User): void {
    this.repository.save({ email: normalizeEmail(user.email), name: user.name });
  }
}
