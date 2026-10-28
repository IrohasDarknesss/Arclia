const ALLOWED_FULL_TEXT_LICENSES = new Set([
  "http://creativecommons.org/licenses/by/4.0/",
  "https://creativecommons.org/licenses/by/4.0/",
  "http://creativecommons.org/licenses/by-sa/4.0/",
  "https://creativecommons.org/licenses/by-sa/4.0/",
  "http://creativecommons.org/publicdomain/zero/1.0/",
  "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC BY 4.0",
  "CC BY-SA 4.0",
  "CC0 1.0",
]);

export function isFullTextLicenseAllowed(
  licenseType: string | null | undefined,
): boolean {
  if (!licenseType || !licenseType.trim()) {
    return false;
  }
  const trimmed = licenseType.trim();
  if (ALLOWED_FULL_TEXT_LICENSES.has(trimmed)) {
    return true;
  }
  let normalized = trimmed.toLowerCase().replace(/^https:\/\//, "http://");
  if (normalized.startsWith("http://") && !normalized.endsWith("/")) {
    normalized += "/";
  }
  return ALLOWED_FULL_TEXT_LICENSES.has(normalized);
}
