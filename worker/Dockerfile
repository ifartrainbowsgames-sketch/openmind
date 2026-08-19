# OpenMind run worker — executes queued task graphs off the browser.
# Shares src/lib with the web app, so the build context is the repo root:
#   docker build -f worker/Dockerfile .
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY src ./src
COPY worker ./worker
COPY tsconfig.json ./

ENV NODE_ENV=production
# tsx runs the TypeScript directly — no separate build artifact to keep in sync.
CMD ["npx", "tsx", "worker/index.ts"]
