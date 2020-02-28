FROM node:10
MAINTAINER Motion Bank

WORKDIR /app
COPY . .
RUN npm install --production

EXPOSE 9191
CMD ["node", "src"]
