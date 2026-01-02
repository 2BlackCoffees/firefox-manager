password=$1
user=${2:-neondb_owner}

sudo apt update
sudo apt install postgresql-client-common
sudo apt install postgresql-client
echo "DATABASE_URL=postgresql://$user:$password@ep-divine-cherry-abhcemxd-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" > .env
npm init -y
npm install express pg cors dotenv
npm install --save-dev parcel
npm install bcrypt

