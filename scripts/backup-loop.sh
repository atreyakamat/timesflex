#!/bin/sh
# Runs inside the compose "backup" service: one pg_dump per night at $BACKUP_TIME, newest $BACKUP_KEEP kept.
# "sh /backup-loop.sh now" takes one backup immediately and exits.
set -eu
umask 077

backup() {
  file="/backups/timesflex-$(date +%Y%m%d-%H%M%S).dump"
  pg_dump --format=custom --file="$file.partial" && mv "$file.partial" "$file"
  echo "$(date '+%F %T') saved $file ($(du -h "$file" | cut -f1))"
  ls -1t /backups/timesflex-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
}

if [ "${1:-}" = "now" ]; then backup; exit 0; fi

echo "Nightly backups at $BACKUP_TIME ($TZ), keeping $BACKUP_KEEP."
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%F) $BACKUP_TIME" +%s 2>/dev/null || date -D '%Y-%m-%d %H:%M' -d "$(date +%F) $BACKUP_TIME" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  backup || echo "$(date '+%F %T') backup FAILED"
done
