#!/bin/bash
# ============================================================
# EnginErds CRM — EC2 Setup Script (Amazon Linux 2023)
# Run this once after launching your EC2 t2.micro instance:
#   chmod +x setup-ec2.sh && ./setup-ec2.sh
# ============================================================
set -e

echo ""
echo "======================================================"
echo "  EnginErds CRM — EC2 Setup"
echo "======================================================"
echo ""

# ── 1. System update ─────────────────────────────────────
echo ">>> Updating system..."
sudo dnf update -y
sudo dnf install -y git curl

# ── 2. Node.js 20 ────────────────────────────────────────
echo ">>> Installing Node.js 20..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node -v && npm -v

# ── 3. PM2 (process manager — keeps app running) ─────────
echo ">>> Installing PM2..."
sudo npm install -g pm2

# ── 4. PostgreSQL 15 ─────────────────────────────────────
echo ">>> Installing PostgreSQL..."
sudo dnf install -y postgresql15 postgresql15-server
sudo postgresql-setup --initdb
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Allow password auth (edit pg_hba.conf)
sudo sed -i 's/ident/md5/g' /var/lib/pgsql/data/pg_hba.conf
sudo sed -i 's/peer/md5/g'  /var/lib/pgsql/data/pg_hba.conf
sudo systemctl restart postgresql

# Create DB user + database
DB_PASS="CrmPass_$(openssl rand -hex 6)"
sudo -u postgres psql <<SQL
CREATE USER crmuser WITH PASSWORD '${DB_PASS}';
CREATE DATABASE crmdb OWNER crmuser;
GRANT ALL PRIVILEGES ON DATABASE crmdb TO crmuser;
SQL
echo ">>> Postgres DB created. Password: ${DB_PASS}"

# ── 5. Clone the repo ─────────────────────────────────────
echo ">>> Cloning repo (aws-deploy branch)..."
cd /home/ec2-user
git clone -b aws-deploy https://github.com/Nerds101001/mail.git crm
cd crm

# ── 6. Install dependencies ───────────────────────────────
echo ">>> Installing Node dependencies..."
npm install

# ── 7. Build React frontend ───────────────────────────────
echo ">>> Building React app..."
cd crm-ui && npm install && npm run build && cd ..

# ── 8. Create .env file ───────────────────────────────────
echo ">>> Creating .env file..."
cat > /home/ec2-user/crm/.env <<ENV
# Database (local Postgres — no bandwidth costs)
DATABASE_URL=postgresql://crmuser:${DB_PASS}@localhost:5432/crmdb

# App
PORT=3000

# Admin PIN to log into the CRM
CRM_PIN=enginerds24

# Gmail OAuth (copy from your current Vercel env vars)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://YOUR_EC2_PUBLIC_IP:3000/api/gmail-callback

# Optional
# OPENAI_API_KEY=
ENV

echo ""
echo "======================================================"
echo "  IMPORTANT: Edit your .env file before starting!"
echo "  Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET"
echo "  and set your EC2 public IP in GOOGLE_REDIRECT_URI"
echo ""
echo "  Run: nano /home/ec2-user/crm/.env"
echo "======================================================"
echo ""

# ── 9. Start with PM2 ────────────────────────────────────
echo ">>> Starting app with PM2..."
cd /home/ec2-user/crm
pm2 start server.js --name crm
pm2 startup systemd -u ec2-user --hp /home/ec2-user | grep "sudo" | sudo bash
pm2 save

echo ""
echo "======================================================"
echo "  ✅ Setup complete!"
echo ""
echo "  App is running on port 3000"
echo "  Open port 3000 in your EC2 Security Group"
echo "  Then visit: http://YOUR_EC2_IP:3000"
echo ""
echo "  Useful commands:"
echo "    pm2 logs crm       — view live logs"
echo "    pm2 restart crm    — restart app"
echo "    pm2 stop crm       — stop app"
echo "======================================================"
