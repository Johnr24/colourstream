#!/bin/bash
#
# Certificate Renewal Script for ColourStream
# This script extracts certificates from Traefik's acme.json and updates
# certificates for origin, edge, mirotalk, and coturn services
#

set -e  # Exit on error

# Configuration variables with relative paths
ACME_JSON="../traefik/acme.json"
CERT_DIR="../certs"
DOMAINS=(
  "live.colourstream.johnrogerscolour.co.uk"
  "video.colourstream.johnrogerscolour.co.uk"
  "upload.colourstream.johnrogerscolour.co.uk"
)

# Create certificate directories if they don't exist
mkdir -p "${CERT_DIR}/certs"
mkdir -p "${CERT_DIR}/private"

echo "===== Certificate Renewal Process Started ====="
echo "$(date)"
echo "Extracting certificates from Traefik acme.json..."

# Use the dumpcerts script to extract certificates
./dumpcerts.traefik.v2.sh "${ACME_JSON}" "${CERT_DIR}"

if [ $? -ne 0 ]; then
  echo "Error: Failed to extract certificates from acme.json"
  exit 1
fi

echo "Certificates extracted successfully!"

# Process each domain
for DOMAIN in "${DOMAINS[@]}"; do
  echo "Setting up certificates for ${DOMAIN}..."
  
  # Verify that the certificates exist
  if [ ! -f "${CERT_DIR}/certs/${DOMAIN}.crt" ] || [ ! -f "${CERT_DIR}/private/${DOMAIN}.key" ]; then
    echo "Warning: Certificates for ${DOMAIN} not found. Skipping..."
    continue
  fi
  
  # Create a symlink with .pem extension for compatibility
  ln -sf "${CERT_DIR}/certs/${DOMAIN}.crt" "${CERT_DIR}/certs/${DOMAIN}.pem"
  ln -sf "${CERT_DIR}/private/${DOMAIN}.key" "${CERT_DIR}/private/${DOMAIN}.pem"
  
  echo "Certificate for ${DOMAIN} processed successfully."
done

echo "All certificates processed. Now updating services..."

# Navigate to the parent directory to run docker-compose commands
cd ..

# Update services with new certificates

# 1. Update Origin service
echo "Updating Origin service..."
docker-compose stop origin
docker-compose up -d origin
echo "Origin service updated."

# 2. Update Edge service (if it exists)
if docker-compose ps | grep -q "edge"; then
  echo "Updating Edge service..."
  docker-compose stop edge
  docker-compose up -d edge
  echo "Edge service updated."
else
  echo "Edge service not found, skipping..."
fi

# 3. Update Mirotalk service (if it exists)
if docker-compose ps | grep -q "mirotalk"; then
  echo "Updating Mirotalk service..."
  docker-compose stop mirotalk
  docker-compose up -d mirotalk
  echo "Mirotalk service updated."
else
  echo "Mirotalk service not found, skipping..."
fi

# 4. Update Coturn service (if it exists)
if docker-compose ps | grep -q "coturn"; then
  echo "Updating Coturn service..."
  docker-compose stop coturn
  docker-compose up -d coturn
  echo "Coturn service updated."
else
  echo "Coturn service not found, skipping..."
fi

echo "===== Certificate Renewal Process Completed ====="
echo "$(date)"
echo ""
echo "Note: This process needs to be repeated every 90 days before certificates expire."
echo "Consider setting up a cron job to automate this process."
echo "Suggested cron entry (runs every 60 days):"
echo "0 0 1 */2 * cd /path/to/colourstream && ./setup/renew_certificates.sh >> ./logs/cert_renewal.log 2>&1" 