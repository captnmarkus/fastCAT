# --- Build step ---
FROM node:20-alpine3.20 AS build
WORKDIR /app

# 1. Install dependencies
COPY frontend/package*.json ./
RUN npm install

# 2. Copy source code (Docker will now respect .dockerignore)
COPY frontend ./

# 3. Build Vite app
RUN npm run build

# --- Runtime: nginx ---
FROM nginx:alpine3.20
COPY web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
