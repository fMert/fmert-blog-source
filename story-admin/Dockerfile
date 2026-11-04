FROM golang:1.25-alpine AS build
WORKDIR /src
COPY main.go analytics.go likes.go limits.go admin-i18n.js ./
RUN CGO_ENABLED=0 go build -o /story-admin main.go analytics.go likes.go limits.go

FROM scratch
COPY --from=build /story-admin /story-admin
EXPOSE 8081
ENTRYPOINT ["/story-admin"]
