FROM node:20-alpine3.20 AS build
WORKDIR /app

COPY package*.json ./
# Use npm install to ensure dependencies are installed even without lockfile
RUN npm install 
COPY tsconfig.json ./

# FIXED: Copy the source code so TypeScript has something to compile
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine3.20
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache \
  libreoffice \
  fontconfig \
  ttf-dejavu

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# uploads under /data
ENV CAT_UPLOAD_DIR=/data/uploads
VOLUME ["/data"]

EXPOSE 4000
CMD ["node", "dist/app.js"]
