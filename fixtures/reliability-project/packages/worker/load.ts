export async function loadWorker(modulePath: string) {
  return import(modulePath);
}
