export function createUser(email: string): boolean {
  return validateUser(email);
}

export function validateUser(email: string): boolean {
  saveUser(email);
  return email.includes('@');
}

export function saveUser(email: string): void {
  void email;
}
