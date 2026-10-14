# A versão da imagem deve ser IGUAL à do pacote playwright no package.json
FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
VOLUME ["/app/data", "/app/logs", "/app/debug"]
# navegador "visível" num monitor virtual: a Cloudflare desconfia mais de headless
CMD ["xvfb-run", "-a", "npm", "start"]
