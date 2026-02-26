FROM node:20-alpine3.20 AS build
WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

# Install dependencies (handling the lockfile mismatch)
RUN npm install

# Build TS -> JS
RUN npm run build
RUN npm prune --omit=dev

# --- Runtime Stage ---
FROM node:20-alpine3.20
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3001
CMD ["node", "dist/index.js"]
