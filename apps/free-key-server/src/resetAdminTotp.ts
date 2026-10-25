import { loadConfig } from "./config.js";
import { LicenseStore } from "./licenseStore.js";

const store = new LicenseStore(loadConfig());
try {
  store.resetAdminTotp();
  store.recordAudit("server-console", "reset_totp", {});
  console.log("Administrator TOTP binding was reset. The next login must bind a new authenticator.");
} finally {
  store.close();
}
