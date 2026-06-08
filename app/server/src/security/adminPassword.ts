const FALLBACK_ADMIN_PASSWORD = "admin";

export function initialAdminPassword(): string {
  const password = process.env.TRACKFOLIO_ADMIN_PASSWORD?.trim();
  return password && password.length > 0 ? password : FALLBACK_ADMIN_PASSWORD;
}
