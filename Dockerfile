FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY assets ./assets
COPY data ./data
RUN node src/build.mjs

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site /usr/share/nginx/html
EXPOSE 80
