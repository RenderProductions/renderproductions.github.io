# Container for the Rend-Conomy bot (used by Fly.io).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so they're cached between deploys.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 8080
CMD ["npm", "start"]
