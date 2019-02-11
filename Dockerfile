FROM node:9
MAINTAINER Motion Bank

WORKDIR /app
COPY . .
RUN rm -rf node_modules
RUN npm install --production

EXPOSE 9191
CMD ["node", "src"]
