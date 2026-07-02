FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install

COPY Origin_Server/ .

RUN mkdir -p /app/movies && chmod 777 /app/movies

EXPOSE 4000

CMD ["node", "server.js"]