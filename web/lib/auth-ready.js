import { configured as usersConfigured } from "./users.js";
import { configured as otpConfigured } from "./otp.js";
import { emailConfigured } from "./notify.js";

export function authReady() {
  return Boolean(usersConfigured() && otpConfigured() && emailConfigured());
}
