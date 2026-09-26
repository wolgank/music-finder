# music-vault-server

API y scripts de sincronización musical (Bun + Hono + SQLite).

## Dónde está la base de datos

Todo el dato runtime vive en `data/`:

```
data/
├── music_vault.db          # SQLite principal
├── library_index.json      # índice de mapeo Spotify → Tidal
├── reports/                # auditorías y reportes .txt
└── orphaned/               # restos WAL/SHM si no había .db
```

Backups timestamped: `backups/`.

## Install

```sh
bun install
```

## Run API

```sh
bun run dev
```

Abre http://localhost:3000

## Scripts útiles

```sh
# Backup de la DB
bun run src/scripts/backup-db.ts

# Scripts legacy (solo referencia)
# src/scripts/archive/
```
