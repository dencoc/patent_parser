# Dockerfile

FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev  # только production зависимости

COPY . .

RUN npx playwright install --with-deps chromium

USER pwuser

CMD ["node", "parser_patents.js"]