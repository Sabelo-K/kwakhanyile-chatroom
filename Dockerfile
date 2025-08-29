# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Copy manifest(s) and install production deps
COPY package*.json ./
RUN npm ci --omit=dev || npm install --production

# Copy the rest of the app
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
