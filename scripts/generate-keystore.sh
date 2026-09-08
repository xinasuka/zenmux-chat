#!/usr/bin/env bash
# scripts/generate-keystore.sh
# Generates a production signing keystore for ZenChat and displays
# the Base64 secret required for GitHub Actions CI/CD.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
KEYSTORE_PATH="${ROOT_DIR}/android/app/release.keystore"
KEY_ALIAS="zenchat"

echo "============================================================"
echo "  ZenChat Production Android Keystore Generator"
echo "============================================================"

if [ -f "${KEYSTORE_PATH}" ]; then
  echo "Existing keystore detected at: ${KEYSTORE_PATH}"
  read -r -p "Do you want to overwrite it? (y/N): " CONFIRM
  if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
    echo "Aborting keystore generation."
    exit 0
  fi
  rm -f "${KEYSTORE_PATH}"
fi

# Prompt for secure password
if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  read -s -r -p "Enter Keystore & Key Password (min 6 characters): " PASSWORD
  echo ""
  read -s -r -p "Confirm Password: " PASSWORD_CONFIRM
  echo ""
  if [ "${PASSWORD}" != "${PASSWORD_CONFIRM}" ]; then
    echo "Error: Passwords do not match." >&2
    exit 1
  fi
  if [ ${#PASSWORD} -lt 6 ]; then
    echo "Error: Password must be at least 6 characters." >&2
    exit 1
  fi
else
  PASSWORD="${KEYSTORE_PASSWORD}"
fi

echo ""
echo "Generating 2048-bit RSA PKCS12 production keystore..."

keytool -genkeypair -v \
  -keystore "${KEYSTORE_PATH}" \
  -alias "${KEY_ALIAS}" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype PKCS12 \
  -storepass "${PASSWORD}" \
  -keypass "${PASSWORD}" \
  -dname "CN=ZenChat, OU=Mobile, O=ZenMux, L=Global, ST=Global, C=US"

echo "Keystore successfully generated at: ${KEYSTORE_PATH}"
echo ""

# Generate Base64 representation for GitHub Secrets
BASE64_OUTPUT="$(base64 < "${KEYSTORE_PATH}" | tr -d '\n')"

echo "============================================================"
echo "  GitHub Repository Secrets Setup Instructions"
echo "============================================================"
echo "Navigate to your GitHub repo -> Settings -> Secrets and variables -> Actions"
echo "Add the following 4 Repository Secrets:"
echo ""
echo "1. ANDROID_KEYSTORE_BASE64"
echo "   Value: (Copy the Base64 string below)"
echo "   ---------------------------------------------------------"
echo "${BASE64_OUTPUT}"
echo "   ---------------------------------------------------------"
echo ""
echo "2. ANDROID_KEYSTORE_PASSWORD"
echo "   Value: <Your keystore password>"
echo ""
echo "3. ANDROID_KEY_ALIAS"
echo "   Value: ${KEY_ALIAS}"
echo ""
echo "4. ANDROID_KEY_PASSWORD"
echo "   Value: <Your key password>"
echo "============================================================"
