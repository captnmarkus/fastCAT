# --- Build step ---
FROM node:20-alpine3.20 AS build
WORKDIR /app

# Install frontend deps
COPY frontend/package*.json ./

# FIXED: Use 'npm install' instead of 'npm ci' to handle the updated package.json
# even if package-lock.json is out of sync or missing.
RUN npm install

# Copy the rest of the frontend code
# Ensure this copies to ./ (root of workdir), NOT ./frontend
COPY frontend ./

# Build Vite app
RUN npm run build

# --- Runtime: nginx ---
FROM nginx:alpine3.20

# Our nginx vhost
# Make sure this path matches where your nginx.conf actually is in your project structure
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

# Built static assets
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
