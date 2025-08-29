# Server Deploy Guide

## Option D — Localtunnel (fastest)
1) In this folder:
   npm install
   npm start
2) New terminal:
   npx localtunnel --port 3000 --subdomain kwakhanyile
3) Create `.env` with:
   BASE_URL=https://kwakhanyile.loca.lt
Restart the app so QR codes use your public URL.

## Option B — Render.com (free)
Use render.yaml and set BASE_URL after first deploy, then redeploy.

## Option C — Docker + Caddy on your own server
Use Dockerfile, docker-compose.yml, Caddyfile and set DOMAIN/EMAIL/BASE_URL in .env.
