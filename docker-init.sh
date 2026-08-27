#!/bin/bash
# Fix pg_hba.conf for development - allow TCP connections with trust auth

sed -i 's/host all all all scram-sha-256/host all all all trust/g' "$PGDATA/pg_hba.conf"

echo "pg_hba.conf updated to allow TCP connections"
