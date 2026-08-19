# OpenMind — Railway / container deploy (static Vite build + nginx)
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_KEY
ARG VITE_ROUTER=browser
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_KEY=$VITE_SUPABASE_KEY \
    VITE_ROUTER=$VITE_ROUTER

RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
