# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build -- --configuration=production

# Production stage – lightweight static file server, no nginx
# SSL and proxying are handled by the nginx reverse-proxy container
FROM node:20-alpine
RUN npm install -g serve@14
COPY --from=build /app/dist/agora/browser /app/public
EXPOSE 80
CMD ["serve", "-s", "/app/public", "-l", "80"]
