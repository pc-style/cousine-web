#!/bin/bash

#===============================================================================
# Google Cloud Deployment Script for Voice & Text Chat
#
# This script deploys the cousine-web voice chat application to Google Cloud
# using settings from your gcloud CLI configuration.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - A GCP project with billing enabled
#   - Compute Engine API enabled
#
# Usage:
#   chmod +x deploy-gcloud.sh
#   ./deploy-gcloud.sh
#===============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

#===============================================================================
# Configuration
#===============================================================================

# Instance settings
INSTANCE_NAME="voice-chat-server"
MACHINE_TYPE="e2-small"
BOOT_DISK_SIZE="10GB"
IMAGE_FAMILY="debian-12"
IMAGE_PROJECT="debian-cloud"

# Network settings
FIREWALL_RULE_NAME="allow-voice-chat"
NETWORK_TAG="voice-chat-server"
APP_PORT="8001"

# GitHub repository
GITHUB_REPO="https://github.com/pc-style/cousine-web.git"

# Temporary file for startup script
STARTUP_SCRIPT_FILE=$(mktemp /tmp/startup-script-XXXXXX.sh)

#===============================================================================
# Cleanup function
#===============================================================================
cleanup() {
    rm -f "$STARTUP_SCRIPT_FILE"
}
trap cleanup EXIT

#===============================================================================
# Get configuration from gcloud CLI
#===============================================================================

print_info "Reading configuration from gcloud CLI..."

# Get project ID from gcloud config
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    print_error "No project ID found in gcloud config."
    print_info "Please run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi
print_info "Project ID: $PROJECT_ID"

# Get region from gcloud config
REGION=$(gcloud config get-value compute/region 2>/dev/null)
if [ -z "$REGION" ]; then
    print_warning "No region found in gcloud config. Using default: us-central1"
    REGION="us-central1"
fi
print_info "Region: $REGION"

# Get zone from gcloud config, or derive from region
ZONE=$(gcloud config get-value compute/zone 2>/dev/null)
if [ -z "$ZONE" ]; then
    ZONE="${REGION}-a"
    print_warning "No zone found in gcloud config. Using: $ZONE"
fi
print_info "Zone: $ZONE"

#===============================================================================
# Enable required APIs
#===============================================================================

print_info "Enabling required APIs..."
gcloud services enable compute.googleapis.com --project="$PROJECT_ID" --quiet

#===============================================================================
# Create Firewall Rule
#===============================================================================

print_info "Checking firewall rules..."

if gcloud compute firewall-rules describe "$FIREWALL_RULE_NAME" --project="$PROJECT_ID" &>/dev/null; then
    print_warning "Firewall rule '$FIREWALL_RULE_NAME' already exists. Skipping creation."
else
    print_info "Creating firewall rule to allow traffic on port $APP_PORT..."
    gcloud compute firewall-rules create "$FIREWALL_RULE_NAME" \
        --project="$PROJECT_ID" \
        --direction=INGRESS \
        --priority=1000 \
        --network=default \
        --action=ALLOW \
        --rules=tcp:$APP_PORT \
        --source-ranges=0.0.0.0/0 \
        --target-tags="$NETWORK_TAG" \
        --description="Allow voice chat application traffic on port $APP_PORT"
    print_success "Firewall rule created."
fi

#===============================================================================
# Create Startup Script File
#===============================================================================

print_info "Preparing startup script..."

cat > "$STARTUP_SCRIPT_FILE" << 'EOFSCRIPT'
#!/bin/bash
set -e

exec > >(tee /var/log/startup-script.log) 2>&1
echo "Starting deployment at $(date)"

apt-get update
apt-get upgrade -y

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

APP_DIR="/opt/voice-chat"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [ -d ".git" ]; then
    echo "Repository exists, pulling latest..."
    git pull origin main
else
    echo "Cloning repository..."
    git clone https://github.com/pc-style/cousine-web.git .
fi

npm install --production

cat > /etc/systemd/system/voice-chat.service << 'SERVICEEOF'
[Unit]
Description=Voice Chat Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/voice-chat
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=8001
StandardOutput=append:/var/log/voice-chat.log
StandardError=append:/var/log/voice-chat-error.log

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable voice-chat
systemctl start voice-chat

echo "Deployment completed at $(date)"
echo "Voice Chat server is running on port 8001"
EOFSCRIPT

chmod +x "$STARTUP_SCRIPT_FILE"

#===============================================================================
# Check if instance already exists
#===============================================================================

print_info "Checking if instance '$INSTANCE_NAME' already exists..."

if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --project="$PROJECT_ID" &>/dev/null; then
    print_warning "Instance '$INSTANCE_NAME' already exists."
    read -p "Do you want to delete and recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Deleting existing instance..."
        gcloud compute instances delete "$INSTANCE_NAME" \
            --zone="$ZONE" \
            --project="$PROJECT_ID" \
            --quiet
        print_success "Instance deleted."
    else
        print_info "Keeping existing instance. Exiting."

        EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
            --zone="$ZONE" \
            --project="$PROJECT_ID" \
            --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

        echo ""
        echo "=============================================="
        print_success "Your voice chat server is available at:"
        echo -e "  ${GREEN}http://${EXTERNAL_IP}:${APP_PORT}${NC}"
        echo "=============================================="
        exit 0
    fi
fi

#===============================================================================
# Create the VM Instance
#===============================================================================

print_info "Creating VM instance '$INSTANCE_NAME'..."

gcloud compute instances create "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family="$IMAGE_FAMILY" \
    --image-project="$IMAGE_PROJECT" \
    --boot-disk-size="$BOOT_DISK_SIZE" \
    --boot-disk-type=pd-standard \
    --tags="$NETWORK_TAG" \
    --metadata-from-file=startup-script="$STARTUP_SCRIPT_FILE" \
    --scopes=https://www.googleapis.com/auth/cloud-platform

print_success "VM instance created."

#===============================================================================
# Wait for the instance to be ready
#===============================================================================

print_info "Waiting for instance to start..."
sleep 10

EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --project="$PROJECT_ID" \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

print_info "External IP: $EXTERNAL_IP"

#===============================================================================
# Wait for the application to be ready
#===============================================================================

print_info "Waiting for application to start (this may take 2-3 minutes)..."

MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    print_info "Checking application status (attempt $ATTEMPT/$MAX_ATTEMPTS)..."

    if curl -s --connect-timeout 5 "http://${EXTERNAL_IP}:${APP_PORT}" > /dev/null 2>&1; then
        print_success "Application is running!"
        break
    fi

    if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
        print_warning "Application may still be starting. Check logs with:"
        echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='sudo journalctl -u voice-chat -f'"
    fi

    sleep 10
done

#===============================================================================
# Output Summary
#===============================================================================

echo ""
echo "=============================================="
print_success "Deployment Complete!"
echo "=============================================="
echo ""
echo "Instance Details:"
echo "  Name:        $INSTANCE_NAME"
echo "  Zone:        $ZONE"
echo "  Machine:     $MACHINE_TYPE"
echo "  External IP: $EXTERNAL_IP"
echo ""
echo -e "${GREEN}Your voice chat server is available at:${NC}"
echo -e "  ${GREEN}http://${EXTERNAL_IP}:${APP_PORT}${NC}"
echo ""
echo "Useful Commands:"
echo "  SSH into instance:"
echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE"
echo ""
echo "  View application logs:"
echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='sudo journalctl -u voice-chat -f'"
echo ""
echo "  View startup script logs:"
echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='sudo cat /var/log/startup-script.log'"
echo ""
echo "  Stop the instance (to save costs):"
echo "    gcloud compute instances stop $INSTANCE_NAME --zone=$ZONE"
echo ""
echo "  Delete the instance:"
echo "    gcloud compute instances delete $INSTANCE_NAME --zone=$ZONE"
echo ""
echo "=============================================="
