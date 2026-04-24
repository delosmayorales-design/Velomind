FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --only=production

# Copy source
COPY backend/ ./backend/
COPY cyclocoach/ ./cyclocoach/

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
