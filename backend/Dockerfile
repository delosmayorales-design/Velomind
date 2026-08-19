FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

# Koyeb inyecta $PORT en tiempo de ejecución — server.js ya lo respeta
# (process.env.PORT || 3000), así que no se fija un valor aquí.
EXPOSE 3000

CMD ["node", "server.js"]
