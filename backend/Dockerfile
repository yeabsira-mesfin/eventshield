FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY db.js policy.js extensions.js server.js schema.sql ./
COPY scripts ./scripts
EXPOSE 3000
CMD ["sh","-c","npm run migrate && npm run seed && npm start"]
