import { AuthService } from './auth';
import { UserRepository, normalizeEmail } from './user';

export function createService(): AuthService {
  const repository = new UserRepository();
  return new AuthService(repository);
}

export function main(email: string, password: string): boolean {
  const service = createService();
  const normalized = normalizeEmail(email);
  return service.login(normalized, password);
}

export const bootstrap = (): boolean => {
  return main('user@example.com', 'secret');
};
