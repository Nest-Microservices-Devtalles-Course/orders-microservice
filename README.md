# Orders MicroService

```
docker compose up -d
```

## Development pasos

1. Clonar el proyecto
2. Crear un archivo `.env` basado en el archivo `.env.template`
3. Levantar la base de datos con `docker compose up -d`
4. Levantar el servidor NATS
```
docker run -d --name nats-server -p 4222:4222 -p 8222:8222 nats
```
4. Levantar el proyecto con `npm run start:dev`

[irrelevant change]