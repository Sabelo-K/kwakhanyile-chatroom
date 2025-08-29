# syntax=docker/dockerfile:1
FROM node:20-alpine as base
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./ 2>/dev/null || true
RUN npm install --production
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
