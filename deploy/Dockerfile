FROM ruby:3.4-alpine AS builder
RUN apk add --no-cache bash build-base git yaml-dev
WORKDIR /src
COPY Gemfile Gemfile.lock* ./
RUN bundle config set without test && bundle install --jobs 4 --retry 3
COPY . ./
# Yönetim panelinden oluşturulan kalıcı Markdown dosyalarını Jekyll koleksiyonuna ekle.
ENV JEKYLL_ENV=production
RUN bash tools/build-languages.sh /site

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /site /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
